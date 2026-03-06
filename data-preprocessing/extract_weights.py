#!/usr/bin/env python3
"""
Extract Ridge model weights for the Sandlot Score v2 formula.
Trains on MWC simulation data and prints coefficients ready for
preprocess-to-postgres.py.

Usage: python extract_weights.py
"""

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.model_selection import cross_val_predict
from scipy.stats import pearsonr
from pathlib import Path

OUT_DIR = Path('sim-results')

# ============================================================
# 1. Load Data
# ============================================================
mwc = pd.read_parquet(OUT_DIR / 'player_mwc.parquet')
rf = mwc[mwc['n_appearances'] >= 30].copy()
bat = rf[rf['player_type'] == 'batter'].copy()
pit = rf[rf['player_type'] == 'pitcher'].copy()
sp = pit[pit['primary_position'] == 'SP'].copy()
rp = pit[pit['primary_position'] == 'RP'].copy()

print(f'Batters: {len(bat)}, SP: {len(sp)}, RP: {len(rp)}')


def sandlot_score(z):
    return 1.0 + ((np.clip(z, -2, 10) + 2) / 12) * 9.0


def pred_to_z(pred, ref_z):
    return (pred - pred.mean()) / pred.std() * ref_z.std() + ref_z.mean()


# ============================================================
# 2. Batter Model (19 features: 12 blended z + 7 position dummies)
# ============================================================
print('\n' + '='*60)
print('BATTER MODEL')
print('='*60)

bat_pz = ['sc_pz_R', 'sc_pz_HR', 'sc_pz_RBI', 'sc_pz_SB', 'sc_pz_H', 'sc_pz_Outs']
bat_oz = ['sc_oz_R', 'sc_oz_HR', 'sc_oz_RBI', 'sc_oz_SB', 'sc_oz_H', 'sc_oz_Outs']
bat_blend = bat_pz + bat_oz
bat_positions = sorted(bat['primary_position'].unique())
pos_dummies_bat = pd.get_dummies(bat['primary_position'], prefix='pos')

X_bat = np.column_stack([
    bat[bat_blend].values.astype(float),
    pos_dummies_bat.values,
])
target_bat = bat['controlled_mwc'].values
feat_names_bat = list(bat_blend) + [f'pos_{p}' for p in bat_positions]

model_bat = Ridge(alpha=1.0).fit(X_bat, target_bat)

# Validate
pred_bat = cross_val_predict(Ridge(alpha=1.0), X_bat, target_bat, cv=5)
cur_z_bat = bat['z_score_position'].values.astype(float)
new_z_bat = pred_to_z(pred_bat, cur_z_bat)
r_cur = pearsonr(sandlot_score(cur_z_bat), target_bat)[0]
r_new = pearsonr(sandlot_score(new_z_bat), target_bat)[0]
print(f'Pearson r: current={r_cur:.4f}, new={r_new:.4f} (+{r_new-r_cur:.4f})')

# Print coefficients
print('\n--- Batter Z-Score Weights ---')
print('# Maps experiment columns → pipeline columns:')
print('# sc_pz_R → R_POS_Z, sc_oz_R → R_Z, etc.')

# Group into z-score weights and position intercepts
z_weights = {}
pos_intercepts = {}
for name, coef in zip(feat_names_bat, model_bat.coef_):
    if name.startswith('pos_'):
        pos_intercepts[name.replace('pos_', '')] = coef
    else:
        z_weights[name] = coef

print('\nBAT_Z_WEIGHTS = {')
# Map experiment column names to pipeline column names
exp_to_pipeline = {
    'sc_pz_R': 'R_POS_Z', 'sc_pz_HR': 'HR_POS_Z', 'sc_pz_RBI': 'RBI_POS_Z',
    'sc_pz_SB': 'SB_POS_Z', 'sc_pz_H': 'H_POS_Z', 'sc_pz_Outs': 'Outs_POS_Z',
    'sc_oz_R': 'R_Z', 'sc_oz_HR': 'HR_Z', 'sc_oz_RBI': 'RBI_Z',
    'sc_oz_SB': 'SB_Z', 'sc_oz_H': 'H_Z', 'sc_oz_Outs': 'Outs_Z',
}
for exp_name, coef in z_weights.items():
    pipeline_name = exp_to_pipeline[exp_name]
    print(f"    '{pipeline_name}': {coef:.10f},  # {exp_name}")
print('}')

print(f'\nBAT_POS_INTERCEPTS = {{')
for pos, coef in sorted(pos_intercepts.items()):
    print(f"    '{pos}': {coef:.10f},")
print('}')

print(f'\nBAT_MODEL_INTERCEPT = {model_bat.intercept_:.10f}')

# ============================================================
# 3. SP Model (16 features: 10 blended z + 6 raw stats)
# ============================================================
print('\n' + '='*60)
print('SP MODEL')
print('='*60)

pit_pz = ['sc_pz_W', 'sc_pz_SV', 'sc_pz_SO', 'sc_pz_ER_saved', 'sc_pz_BR_saved']
pit_oz = ['sc_oz_W', 'sc_oz_SV', 'sc_oz_SO', 'sc_oz_ER_saved', 'sc_oz_BR_saved']
pit_blend = pit_pz + pit_oz
raw_pit = ['W', 'SV', 'K', 'ERA', 'WHIP', 'IP']

X_sp = np.column_stack([sp[pit_blend].values.astype(float),
                         sp[raw_pit].values.astype(float)])
target_sp = sp['controlled_mwc'].values
feat_names_sp = list(pit_blend) + raw_pit

model_sp = Ridge(alpha=1.0).fit(X_sp, target_sp)

# In the pipeline, sc_pz_W == sc_oz_W (both are W_Z) and sc_pz_SV == sc_oz_SV (both are SV_Z).
# So the effective weight for W_Z = coef[sc_pz_W] + coef[sc_oz_W].
# For SO, ER_saved, BR_saved: positional and overall are different columns.

# Map to pipeline columns, collapsing W/SV pairs
pit_exp_to_pipeline = {
    'sc_pz_SO': 'SO_POS_Z', 'sc_pz_ER_saved': 'ER_saved_POS_Z', 'sc_pz_BR_saved': 'BR_saved_POS_Z',
    'sc_oz_SO': 'SO_Z', 'sc_oz_ER_saved': 'ER_saved_Z', 'sc_oz_BR_saved': 'BR_saved_Z',
}

# Collapse W and SV weights
sp_coefs = dict(zip(feat_names_sp, model_sp.coef_))
sp_w_z_effective = sp_coefs['sc_pz_W'] + sp_coefs['sc_oz_W']
sp_sv_z_effective = sp_coefs['sc_pz_SV'] + sp_coefs['sc_oz_SV']

print('\nSP_WEIGHTS = {')
print(f"    # W_Z and SV_Z are overall z-scores (sc_pz == sc_oz in pipeline)")
print(f"    'W_Z': {sp_w_z_effective:.10f},  # sc_pz_W ({sp_coefs['sc_pz_W']:.10f}) + sc_oz_W ({sp_coefs['sc_oz_W']:.10f})")
print(f"    'SV_Z': {sp_sv_z_effective:.10f},  # sc_pz_SV ({sp_coefs['sc_pz_SV']:.10f}) + sc_oz_SV ({sp_coefs['sc_oz_SV']:.10f})")
for exp_name, pipeline_name in pit_exp_to_pipeline.items():
    print(f"    '{pipeline_name}': {sp_coefs[exp_name]:.10f},  # {exp_name}")
for col in raw_pit:
    print(f"    '{col}': {sp_coefs[col]:.10f},")
print('}')
print(f'SP_INTERCEPT = {model_sp.intercept_:.10f}')

# Validate SP
pred_sp = cross_val_predict(Ridge(alpha=1.0), X_sp, target_sp, cv=5)
cur_z_sp = sp['z_score_position'].values.astype(float)
new_z_sp = pred_to_z(pred_sp, cur_z_sp)
r_cur_sp = pearsonr(sandlot_score(cur_z_sp), target_sp)[0]
r_new_sp = pearsonr(sandlot_score(new_z_sp), target_sp)[0]
print(f'SP Pearson r: current={r_cur_sp:.4f}, new={r_new_sp:.4f} (+{r_new_sp-r_cur_sp:.4f})')

# ============================================================
# 4. RP Model (16 features: same structure)
# ============================================================
print('\n' + '='*60)
print('RP MODEL')
print('='*60)

X_rp = np.column_stack([rp[pit_blend].values.astype(float),
                         rp[raw_pit].values.astype(float)])
target_rp = rp['controlled_mwc'].values

model_rp = Ridge(alpha=1.0).fit(X_rp, target_rp)

rp_coefs = dict(zip(feat_names_sp, model_rp.coef_))
rp_w_z_effective = rp_coefs['sc_pz_W'] + rp_coefs['sc_oz_W']
rp_sv_z_effective = rp_coefs['sc_pz_SV'] + rp_coefs['sc_oz_SV']

print('\nRP_WEIGHTS = {')
print(f"    'W_Z': {rp_w_z_effective:.10f},  # sc_pz_W ({rp_coefs['sc_pz_W']:.10f}) + sc_oz_W ({rp_coefs['sc_oz_W']:.10f})")
print(f"    'SV_Z': {rp_sv_z_effective:.10f},  # sc_pz_SV ({rp_coefs['sc_pz_SV']:.10f}) + sc_oz_SV ({rp_coefs['sc_oz_SV']:.10f})")
for exp_name, pipeline_name in pit_exp_to_pipeline.items():
    print(f"    '{pipeline_name}': {rp_coefs[exp_name]:.10f},  # {exp_name}")
for col in raw_pit:
    print(f"    '{col}': {rp_coefs[col]:.10f},")
print('}')
print(f'RP_INTERCEPT = {model_rp.intercept_:.10f}')

# Validate RP
pred_rp = cross_val_predict(Ridge(alpha=1.0), X_rp, target_rp, cv=5)
cur_z_rp = rp['z_score_position'].values.astype(float)
new_z_rp = pred_to_z(pred_rp, cur_z_rp)
r_cur_rp = pearsonr(sandlot_score(cur_z_rp), target_rp)[0]
r_new_rp = pearsonr(sandlot_score(new_z_rp), target_rp)[0]
print(f'RP Pearson r: current={r_cur_rp:.4f}, new={r_new_rp:.4f} (+{r_new_rp-r_cur_rp:.4f})')

# ============================================================
# 5. Scale Factors
# ============================================================
print('\n' + '='*60)
print('SCALE FACTORS')
print('='*60)
print('BATTER_SCALE = 1.05')
print('PITCHER_SCALE = 0.90')

# ============================================================
# 6. Combined Validation
# ============================================================
print('\n' + '='*60)
print('COMBINED VALIDATION')
print('='*60)

# Full pitcher prediction (SP + RP combined)
pit_new_z = np.full(len(pit), np.nan)
pit_new_z[pit['primary_position'].values == 'SP'] = new_z_sp
sp_idx = pit['primary_position'].values == 'SP'
rp_idx = pit['primary_position'].values == 'RP'

# Use index alignment
for i, idx in enumerate(sp.index):
    loc = pit.index.get_loc(idx)
    pit_new_z[loc] = new_z_sp[i]
for i, idx in enumerate(rp.index):
    loc = pit.index.get_loc(idx)
    pit_new_z[loc] = new_z_rp[i]

cur_z_pit = pit['z_score_position'].values.astype(float)
r_cur_pit = pearsonr(sandlot_score(cur_z_pit), pit['controlled_mwc'].values)[0]
r_new_pit = pearsonr(sandlot_score(pit_new_z), pit['controlled_mwc'].values)[0]

print(f'Batters:  r={r_cur:.4f} → {r_new:.4f} (+{r_new-r_cur:.4f})')
print(f'Pitchers: r={r_cur_pit:.4f} → {r_new_pit:.4f} (+{r_new_pit-r_cur_pit:.4f})')

print('\nDone! Copy the weight dicts above into preprocess-to-postgres.py')
