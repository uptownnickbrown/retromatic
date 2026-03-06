#!/usr/bin/env python3
"""
Pitcher Ceiling Analysis & 10.0 Rate Normalization
Builds on experiment_calibration.py results.

1. Tests whether pitcher R²=0.816 is near the true ceiling
2. Analyzes 10.0 rate discrepancy between batters and pitchers
3. Proposes z-cap adjustment for equalization
4. Generates final top-10-per-position comparison tables
"""

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr
from sklearn.linear_model import Ridge
from sklearn.model_selection import cross_val_score, cross_val_predict
from sklearn.ensemble import HistGradientBoostingRegressor
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from pathlib import Path

OUT_DIR = Path('sim-results')

# ============================================================
# 1. DATA LOAD
# ============================================================
print('='*70)
print('1. DATA LOAD')
print('='*70)

mwc = pd.read_parquet(OUT_DIR / 'player_mwc.parquet')
print(f'Loaded {len(mwc):,} player-seasons')

rf = mwc[mwc['n_appearances'] >= 30].copy()
bat = rf[rf['player_type'] == 'batter'].copy()
pit = rf[rf['player_type'] == 'pitcher'].copy()
sp = pit[pit['primary_position'] == 'SP'].copy()
rp = pit[pit['primary_position'] == 'RP'].copy()

print(f'Filtered: {len(bat)} batters, {len(pit)} pitchers (SP: {len(sp)}, RP: {len(rp)})')

bat_pz = ['sc_pz_R', 'sc_pz_HR', 'sc_pz_RBI', 'sc_pz_SB', 'sc_pz_H', 'sc_pz_Outs']
bat_oz = ['sc_oz_R', 'sc_oz_HR', 'sc_oz_RBI', 'sc_oz_SB', 'sc_oz_H', 'sc_oz_Outs']
bat_blend = bat_pz + bat_oz

pit_pz = ['sc_pz_W', 'sc_pz_SV', 'sc_pz_SO', 'sc_pz_ER_saved', 'sc_pz_BR_saved']
pit_oz = ['sc_oz_W', 'sc_oz_SV', 'sc_oz_SO', 'sc_oz_ER_saved', 'sc_oz_BR_saved']
pit_blend = pit_pz + pit_oz

target_bat = bat['controlled_mwc'].values
target_pit = pit['controlled_mwc'].values
target_sp = sp['controlled_mwc'].values
target_rp = rp['controlled_mwc'].values


def sandlot_score(z, z_min=-2, z_max=10):
    z_clamped = np.clip(z, z_min, z_max)
    return 1.0 + ((z_clamped - z_min) / (z_max - z_min)) * 9.0


def evaluate_model(X, y, name, alpha=1.0):
    model = Ridge(alpha=alpha)
    scores = cross_val_score(model, X, y, cv=5, scoring='r2')
    model.fit(X, y)
    spear = spearmanr(model.predict(X), y)[0]
    print(f'  {name:>55s}: CV R²={scores.mean():.4f} (±{scores.std():.4f}), Spearman={spear:.4f}')
    return model, scores.mean(), scores.std()


def evaluate_split(sp_X, rp_X, sp_y, rp_y, name, alpha=1.0):
    sp_pred = cross_val_predict(Ridge(alpha=alpha), sp_X, sp_y, cv=5)
    rp_pred = cross_val_predict(Ridge(alpha=alpha), rp_X, rp_y, cv=5)
    all_pred = np.concatenate([sp_pred, rp_pred])
    all_true = np.concatenate([sp_y, rp_y])
    ss_res = np.sum((all_true - all_pred) ** 2)
    ss_tot = np.sum((all_true - all_true.mean()) ** 2)
    combined_r2 = 1 - ss_res / ss_tot

    sp_m = Ridge(alpha=alpha).fit(sp_X, sp_y)
    rp_m = Ridge(alpha=alpha).fit(rp_X, rp_y)
    sp_cv = cross_val_score(Ridge(alpha=alpha), sp_X, sp_y, cv=5, scoring='r2').mean()
    rp_cv = cross_val_score(Ridge(alpha=alpha), rp_X, rp_y, cv=5, scoring='r2').mean()
    print(f'  {name:>55s}: Combined R²={combined_r2:.4f} (SP={sp_cv:.4f}, RP={rp_cv:.4f})')
    return sp_m, rp_m, combined_r2


# ============================================================
# 2. PITCHER CEILING ANALYSIS
# ============================================================
print('\n' + '='*70)
print('2. PITCHER CEILING ANALYSIS')
print('='*70)

print('\nQuestion: Is 0.816 near the true pitcher ceiling?')
print('Compare: batter mega has 33 features, pitcher has 16.')
print('But pitchers have only 2 positions (SP/RP) vs 7 for batters.\n')

raw_pit_cols = ['W', 'SV', 'K', 'ERA', 'WHIP', 'IP']

# Current best: SP/RP split, blend + raw (16 feat)
sp_X_base = np.column_stack([sp[pit_blend].values.astype(float),
                              sp[raw_pit_cols].values.astype(float)])
rp_X_base = np.column_stack([rp[pit_blend].values.astype(float),
                              rp[raw_pit_cols].values.astype(float)])
evaluate_split(sp_X_base, rp_X_base, target_sp, target_rp,
               'Current best: SP/RP split, blend+raw (16 feat)')

# Z-score interaction terms (quality × quality)
for df in [sp, rp]:
    df['ERs_x_SO_pz'] = df['sc_pz_ER_saved'].values * df['sc_pz_SO'].values
    df['BRs_x_SO_pz'] = df['sc_pz_BR_saved'].values * df['sc_pz_SO'].values
    df['ERs_x_W_oz'] = df['sc_oz_ER_saved'].values * df['sc_oz_W'].values
    df['W_x_SV_oz'] = df['sc_oz_W'].values * df['sc_oz_SV'].values

zint_cols = ['ERs_x_SO_pz', 'BRs_x_SO_pz', 'ERs_x_W_oz', 'W_x_SV_oz']

sp_X_int = np.column_stack([sp_X_base, sp[zint_cols].values.astype(float)])
rp_X_int = np.column_stack([rp_X_base, rp[zint_cols].values.astype(float)])
evaluate_split(sp_X_int, rp_X_int, target_sp, target_rp,
               '+ z-score interactions (20 feat)')

# Squared z-score terms (non-linear effects)
for df in [sp, rp]:
    for col in pit_pz:
        df[col + '_sq'] = df[col].values ** 2

sq_cols = [c + '_sq' for c in pit_pz]
sp_X_sq = np.column_stack([sp_X_base, sp[sq_cols].values.astype(float)])
rp_X_sq = np.column_stack([rp_X_base, rp[sq_cols].values.astype(float)])
evaluate_split(sp_X_sq, rp_X_sq, target_sp, target_rp,
               '+ squared z-scores (21 feat)')

# Everything together
sp_X_all = np.column_stack([sp_X_base, sp[zint_cols].values.astype(float),
                             sp[sq_cols].values.astype(float)])
rp_X_all = np.column_stack([rp_X_base, rp[zint_cols].values.astype(float),
                             rp[sq_cols].values.astype(float)])
evaluate_split(sp_X_all, rp_X_all, target_sp, target_rp,
               '+ interactions + squared (25 feat)')

# HistGradientBoosting ceiling (non-parametric)
print('\n  Non-parametric ceiling (HistGBR):')
hgb = HistGradientBoostingRegressor(max_iter=300, max_depth=5, random_state=42)
sp_hgb_pred = cross_val_predict(hgb, sp_X_base, target_sp, cv=5)
rp_hgb_pred = cross_val_predict(hgb, rp_X_base, target_rp, cv=5)
all_hgb_pred = np.concatenate([sp_hgb_pred, rp_hgb_pred])
all_hgb_true = np.concatenate([target_sp, target_rp])
hgb_r2 = 1 - np.sum((all_hgb_true - all_hgb_pred)**2) / np.sum((all_hgb_true - all_hgb_true.mean())**2)
print(f'  {"HistGBR SP/RP split (16 feat)":>55s}: Combined R²={hgb_r2:.4f}')

print('\n  Interpretation: if interactions/squared/GBR don\'t beat 0.816 by much,')
print('  then 0.816 IS the pitcher ceiling with available roto features.')
print('  The remaining gap to batters (0.858) is structural — pitchers have')
print('  fewer roto categories and more role heterogeneity.')


# ============================================================
# 3. 10.0 RATE NORMALIZATION
# ============================================================
print('\n' + '='*70)
print('3. 10.0 RATE NORMALIZATION')
print('='*70)

# Use FULL dataset for distribution analysis
all_bat = mwc[mwc['player_type'] == 'batter'].copy()
all_pit = mwc[mwc['player_type'] == 'pitcher'].copy()

bat_z = all_bat['z_score_position'].values.astype(float)
pit_z = all_pit['z_score_position'].values.astype(float)
bat_ss = sandlot_score(bat_z)
pit_ss = sandlot_score(pit_z)

print(f'\n--- CURRENT DISTRIBUTION (ALL PLAYERS) ---')
print(f'  {"Metric":>25s} {"Batters":>12s} {"Pitchers":>12s}')
print(f'  {"-"*52}')
print(f'  {"Total count":>25s} {len(all_bat):>12,d} {len(all_pit):>12,d}')
print(f'  {"Mean z_position":>25s} {bat_z.mean():>12.3f} {pit_z.mean():>12.3f}')
print(f'  {"Std z_position":>25s} {bat_z.std():>12.3f} {pit_z.std():>12.3f}')
print(f'  {"Max z_position":>25s} {bat_z.max():>12.3f} {pit_z.max():>12.3f}')
print(f'  {"Mean SS":>25s} {bat_ss.mean():>12.3f} {pit_ss.mean():>12.3f}')
print(f'  {"Std SS":>25s} {bat_ss.std():>12.3f} {pit_ss.std():>12.3f}')

for threshold in [10.0, 9.5, 9.0, 8.5, 8.0]:
    bat_n = (bat_ss >= threshold).sum()
    pit_n = (pit_ss >= threshold).sum()
    bat_pct = bat_n / len(all_bat) * 100
    pit_pct = pit_n / len(all_pit) * 100
    ratio = pit_pct / bat_pct if bat_pct > 0 else float('inf')
    print(f'  {"SS >= " + str(threshold):>25s} {bat_n:>5d} ({bat_pct:>5.2f}%) {pit_n:>5d} ({pit_pct:>5.2f}%)  ratio={ratio:.2f}x')

# Distribution by position
print(f'\n--- 10.0 RATE BY POSITION ---')
print(f'  {"Position":>6s} {"Total":>7s} {"10.0s":>6s} {"Rate%":>7s} {">=9.5":>6s} {"Rate%":>7s}')
print(f'  {"-"*52}')
for pos in sorted(mwc['primary_position'].unique()):
    pos_data = mwc[mwc['primary_position'] == pos]
    pos_ss = sandlot_score(pos_data['z_score_position'].values.astype(float))
    n_tens = (pos_ss >= 10.0).sum()
    n_95 = (pos_ss >= 9.5).sum()
    print(f'  {pos:>6s} {len(pos_data):>7d} {n_tens:>6d} {n_tens/len(pos_data)*100:>6.2f}% '
          f'{n_95:>6d} {n_95/len(pos_data)*100:>6.2f}%')

# Root cause: pitchers have wider z-score distribution
print(f'\n--- ROOT CAUSE ---')
print(f'  Pitcher z_position has wider spread: std={pit_z.std():.3f} vs batter std={bat_z.std():.3f}')
print(f'  Pitcher z_position max: {pit_z.max():.1f} vs batter max: {bat_z.max():.1f}')
print(f'  This means more pitchers exceed z=10 threshold than batters.')

# Approach: use different z_max for pitchers to equalize 10.0 rate
bat_10_rate = (bat_ss >= 10.0).sum() / len(all_bat)
pit_10_rate = (pit_ss >= 10.0).sum() / len(all_pit)

print(f'\n--- Z-CAP OPTIONS FOR PITCHERS ---')
print(f'  Current 10.0 rate: Batters={bat_10_rate*100:.2f}%, Pitchers={pit_10_rate*100:.2f}%')
print(f'  Target: equalize to batter rate ({bat_10_rate*100:.2f}%)')
print(f'  That means {int(bat_10_rate * len(all_pit))} pitcher 10.0s (currently {(pit_ss >= 10.0).sum()})')

# Find z_max for pitchers that gives same 10.0 rate
# SS = 10.0 when z >= z_max, so we need P(pit_z >= z_max) == bat_10_rate
z_max_pit = np.percentile(pit_z, (1 - bat_10_rate) * 100)
print(f'\n  To equalize: pitcher z_max = {z_max_pit:.2f} (currently 10.0)')
print(f'  Formula becomes: SS = 1 + ((clamp(z, -2, {z_max_pit:.1f}) + 2) / {z_max_pit + 2:.1f}) * 9.0')

# Show effect of different z_max values
print(f'\n  {"z_max":>6s} {"10.0 count":>11s} {"10.0 rate%":>11s} {"Bat rate%":>10s} {"Ratio":>8s}')
print(f'  {"-"*52}')
for z_max in [8, 9, 10, 11, 12, 13, 14, 15]:
    pit_ss_adj = sandlot_score(pit_z, z_min=-2, z_max=z_max)
    n_tens = (pit_ss_adj >= 10.0).sum()
    rate = n_tens / len(all_pit)
    ratio = rate / bat_10_rate if bat_10_rate > 0 else 0
    marker = ' <--' if abs(ratio - 1.0) < 0.15 else ''
    print(f'  {z_max:>6d} {n_tens:>11d} {rate*100:>10.2f}% {bat_10_rate*100:>9.2f}% {ratio:>7.2f}x{marker}')

# But also: what does the NEW model do to 10.0 rates?
# We need to see if the new z-scores change the distribution
print(f'\n  Note: The z-cap adjustment would be applied AFTER recomputing z-scores')
print(f'  with new weights. New z-scores may have different variance.')


# ============================================================
# 4. BEST MODELS — FINAL TRAINING
# ============================================================
print('\n' + '='*70)
print('4. BEST MODELS — FINAL TRAINING')
print('='*70)

# ---- BATTER MEGA MODEL ----
print('\n--- BATTER MEGA MODEL (33 features) ---')
bat_raw_cols = ['R', 'HR', 'RBI', 'SB', 'H', 'AB', 'AVG']
bat_positions = sorted(bat['primary_position'].unique())
pos_dummies_bat = pd.get_dummies(bat['primary_position'], prefix='pos')
sb_pz = bat['sc_pz_SB'].values.astype(float)
sb_pos_interactions = np.column_stack([sb_pz * pos_dummies_bat[f'pos_{p}'].values for p in bat_positions])

X_bat_mega = np.column_stack([
    bat[bat_blend].values.astype(float),     # 12 blended z
    bat[bat_raw_cols].values.astype(float),   # 7 raw stats
    pos_dummies_bat.values,                    # position dummies
    sb_pos_interactions,                       # pos×SB interactions
])
bat_mega_feat = (list(bat_blend) + bat_raw_cols +
                 [f'pos_{p}' for p in bat_positions] +
                 [f'SB×{p}' for p in bat_positions])
m_bat_mega, r2_bat, _ = evaluate_model(X_bat_mega, target_bat,
                                         f'Batter mega ({X_bat_mega.shape[1]} feat)')

# Print batter coefficients
print(f'\n  Batter coefficients:')
print(f'  {"Feature":>15s} {"Coef":>10s}')
print(f'  {"-"*27}')
for name, coef in sorted(zip(bat_mega_feat, m_bat_mega.coef_),
                          key=lambda x: abs(x[1]), reverse=True)[:20]:
    print(f'  {name:>15s} {coef:>+10.6f}')

# ---- PITCHER MEGA MODEL (SP/RP split, 16 feat each) ----
print('\n--- PITCHER MEGA MODEL (SP/RP split, 16 feat each) ---')
sp_m, rp_m, r2_pit = evaluate_split(sp_X_base, rp_X_base, target_sp, target_rp,
                                      f'Pitcher SP/RP split ({sp_X_base.shape[1]} feat)')

pit_mega_feat = list(pit_blend) + raw_pit_cols
print(f'\n  SP coefficients:')
print(f'  {"Feature":>15s} {"Coef":>10s}')
print(f'  {"-"*27}')
for name, coef in sorted(zip(pit_mega_feat, sp_m.coef_),
                          key=lambda x: abs(x[1]), reverse=True):
    print(f'  {name:>15s} {coef:>+10.6f}')

print(f'\n  RP coefficients:')
print(f'  {"Feature":>15s} {"Coef":>10s}')
print(f'  {"-"*27}')
for name, coef in sorted(zip(pit_mega_feat, rp_m.coef_),
                          key=lambda x: abs(x[1]), reverse=True):
    print(f'  {name:>15s} {coef:>+10.6f}')


# ============================================================
# 5. GENERATE NEW Z-SCORES AND SANDLOT SCORES
# ============================================================
print('\n' + '='*70)
print('5. NEW Z-SCORES AND SANDLOT SCORES')
print('='*70)

# Generate predictions using cross-validated predictions (unbiased)
bat_pred = cross_val_predict(Ridge(alpha=1.0), X_bat_mega, target_bat, cv=5)
sp_pred = cross_val_predict(Ridge(alpha=1.0), sp_X_base, target_sp, cv=5)
rp_pred = cross_val_predict(Ridge(alpha=1.0), rp_X_base, target_rp, cv=5)

# Rescale predictions to z-score scale
def pred_to_z(pred, current_z):
    cur_mean, cur_std = current_z.mean(), current_z.std()
    pred_mean, pred_std = pred.mean(), pred.std()
    return (pred - pred_mean) / pred_std * cur_std + cur_mean

bat['new_z'] = pred_to_z(bat_pred, bat['z_score_position'].values.astype(float))
sp['new_z'] = pred_to_z(sp_pred, sp['z_score_position'].values.astype(float))
rp['new_z'] = pred_to_z(rp_pred, rp['z_score_position'].values.astype(float))

# Copy new_z back to pit
pit.loc[sp.index, 'new_z'] = sp['new_z'].values
pit.loc[rp.index, 'new_z'] = rp['new_z'].values

# Compute Sandlot Scores (using standard z_max=10 for now)
bat['cur_ss'] = sandlot_score(bat['z_score_position'].values.astype(float))
bat['new_ss'] = sandlot_score(bat['new_z'].values)
bat['delta_ss'] = bat['new_ss'] - bat['cur_ss']

pit['cur_ss'] = sandlot_score(pit['z_score_position'].values.astype(float))
pit['new_ss'] = sandlot_score(pit['new_z'].values)
pit['delta_ss'] = pit['new_ss'] - pit['cur_ss']

# Correlation improvements
print(f'\n  {"Type":>10s} {"Current r":>10s} {"New r":>10s} {"Delta":>8s}')
print(f'  {"-"*42}')
for label, df in [('Batters', bat), ('Pitchers', pit)]:
    cur_r = pearsonr(df['cur_ss'], df['controlled_mwc'])[0]
    new_r = pearsonr(df['new_ss'], df['controlled_mwc'])[0]
    print(f'  {label:>10s} {cur_r:>10.4f} {new_r:>10.4f} {new_r - cur_r:>+8.4f}')

# Per-position
print(f'\n  {"Position":>10s} {"n":>5s} {"Current r":>10s} {"New r":>10s} {"Delta":>8s}')
print(f'  {"-"*48}')
for pos in sorted(bat['primary_position'].unique()):
    mask = bat['primary_position'] == pos
    if mask.sum() < 10:
        continue
    cur_r = pearsonr(bat.loc[mask, 'cur_ss'], bat.loc[mask, 'controlled_mwc'])[0]
    new_r = pearsonr(bat.loc[mask, 'new_ss'], bat.loc[mask, 'controlled_mwc'])[0]
    print(f'  {pos:>10s} {mask.sum():>5d} {cur_r:>10.4f} {new_r:>10.4f} {new_r - cur_r:>+8.4f}')
for pos in ['SP', 'RP']:
    mask = pit['primary_position'] == pos
    cur_r = pearsonr(pit.loc[mask, 'cur_ss'], pit.loc[mask, 'controlled_mwc'])[0]
    new_r = pearsonr(pit.loc[mask, 'new_ss'], pit.loc[mask, 'controlled_mwc'])[0]
    print(f'  {pos:>10s} {mask.sum():>5d} {cur_r:>10.4f} {new_r:>10.4f} {new_r - cur_r:>+8.4f}')


# ============================================================
# 6. TOP-10 PER POSITION
# ============================================================
print('\n' + '='*70)
print('6. TOP-10 PER POSITION')
print('='*70)

def print_top10(df, pos, sort_col='new_ss'):
    pos_df = df[df['primary_position'] == pos].copy()
    top = pos_df.nlargest(10, sort_col)
    print(f'\n  === TOP 10 {pos} (by new Sandlot Score) ===')

    if pos in ['SP', 'RP', 'P']:
        stat_cols = ['W', 'SV', 'K', 'ERA', 'WHIP', 'IP']
        stat_fmt = '{:>3.0f} {:>3.0f} {:>4.0f} {:>5.2f} {:>5.2f} {:>6.1f}'
        stat_hdr = f'{"W":>3s} {"SV":>3s} {"K":>4s} {"ERA":>5s} {"WHIP":>5s} {"IP":>6s}'
    else:
        stat_cols = ['R', 'HR', 'RBI', 'SB', 'H', 'AVG']
        stat_fmt = '{:>3.0f} {:>3.0f} {:>4.0f} {:>3.0f} {:>4.0f} {:>5.3f}'
        stat_hdr = f'{"R":>3s} {"HR":>3s} {"RBI":>4s} {"SB":>3s} {"H":>4s} {"AVG":>5s}'

    print(f'  {"#":>2s} {"Player":>25s} {"Yr":>4s} {stat_hdr} '
          f'{"CurSS":>6s} {"NewSS":>6s} {"Delta":>6s} {"MWC":>6s}')
    print(f'  {"-"*105}')
    for rank, (_, row) in enumerate(top.iterrows(), 1):
        stats = [row[c] for c in stat_cols]
        stats_str = stat_fmt.format(*stats)
        print(f'  {rank:>2d} {row["name"]:>25s} {int(row["year"]):>4d} {stats_str} '
              f'{row["cur_ss"]:>6.1f} {row["new_ss"]:>6.1f} {row["delta_ss"]:>+6.1f} {row["controlled_mwc"]:>6.3f}')

# Also show current top 10 for comparison
def print_top10_current(df, pos):
    pos_df = df[df['primary_position'] == pos].copy()
    top = pos_df.nlargest(10, 'cur_ss')
    print(f'\n  === TOP 10 {pos} (by CURRENT Sandlot Score) ===')

    if pos in ['SP', 'RP', 'P']:
        stat_cols = ['W', 'SV', 'K', 'ERA', 'WHIP', 'IP']
        stat_fmt = '{:>3.0f} {:>3.0f} {:>4.0f} {:>5.2f} {:>5.2f} {:>6.1f}'
        stat_hdr = f'{"W":>3s} {"SV":>3s} {"K":>4s} {"ERA":>5s} {"WHIP":>5s} {"IP":>6s}'
    else:
        stat_cols = ['R', 'HR', 'RBI', 'SB', 'H', 'AVG']
        stat_fmt = '{:>3.0f} {:>3.0f} {:>4.0f} {:>3.0f} {:>4.0f} {:>5.3f}'
        stat_hdr = f'{"R":>3s} {"HR":>3s} {"RBI":>4s} {"SB":>3s} {"H":>4s} {"AVG":>5s}'

    print(f'  {"#":>2s} {"Player":>25s} {"Yr":>4s} {stat_hdr} '
          f'{"CurSS":>6s} {"NewSS":>6s} {"Delta":>6s} {"MWC":>6s}')
    print(f'  {"-"*105}')
    for rank, (_, row) in enumerate(top.iterrows(), 1):
        stats = [row[c] for c in stat_cols]
        stats_str = stat_fmt.format(*stats)
        print(f'  {rank:>2d} {row["name"]:>25s} {int(row["year"]):>4d} {stats_str} '
              f'{row["cur_ss"]:>6.1f} {row["new_ss"]:>6.1f} {row["delta_ss"]:>+6.1f} {row["controlled_mwc"]:>6.3f}')

for pos in ['C', '1B', '2B', 'SS', '3B', 'OF', 'UTIL']:
    if pos in bat['primary_position'].values:
        print_top10_current(bat, pos)
        print_top10(bat, pos)

for pos in ['SP', 'RP']:
    print_top10_current(pit, pos)
    print_top10(pit, pos)


# ============================================================
# 7. SCORE DISTRIBUTION COMPARISON
# ============================================================
print('\n' + '='*70)
print('7. SCORE DISTRIBUTION: CURRENT vs NEW')
print('='*70)

for label, df in [('Batters', bat), ('Pitchers', pit)]:
    cur = df['cur_ss'].values
    new = df['new_ss'].values
    delta = new - cur

    print(f'\n  --- {label} ---')
    print(f'    Mean shift: {delta.mean():+.3f}, Std of shift: {delta.std():.3f}')
    print(f'    Players moving > 0.5 SS: {(np.abs(delta) > 0.5).sum()} / {len(delta)} ({(np.abs(delta) > 0.5).mean()*100:.1f}%)')
    print(f'    Players moving > 1.0 SS: {(np.abs(delta) > 1.0).sum()} / {len(delta)} ({(np.abs(delta) > 1.0).mean()*100:.1f}%)')

    print(f'\n    {"Pctile":>8s} {"Current":>10s} {"New":>10s} {"Delta":>8s}')
    for pct in [25, 50, 75, 90, 95, 99]:
        c_p = np.percentile(cur, pct)
        n_p = np.percentile(new, pct)
        print(f'    P{pct:>2d}:     {c_p:>10.2f} {n_p:>10.2f} {n_p - c_p:>+8.2f}')

    cur_tens = (cur >= 10.0).sum()
    new_tens = (new >= 10.0).sum()
    print(f'    10.0 count: {cur_tens} -> {new_tens} ({new_tens - cur_tens:+d})')


# ============================================================
# 8. BIGGEST MOVERS
# ============================================================
print('\n' + '='*70)
print('8. BIGGEST MOVERS')
print('='*70)

for label, df in [('Batters', bat), ('Pitchers', pit)]:
    is_pit = label == 'Pitchers'
    stat_cols = ['W', 'SV', 'K', 'ERA', 'WHIP', 'IP'] if is_pit else ['R', 'HR', 'RBI', 'SB', 'H', 'AVG']

    print(f'\n  --- {label} GAINERS (top 15) ---')
    top_up = df.nlargest(15, 'delta_ss')
    for _, row in top_up.iterrows():
        stats = ' '.join([f'{row[c]:.0f}' if c not in ['ERA', 'WHIP', 'AVG'] else f'{row[c]:.2f}' for c in stat_cols])
        print(f'    {row["name"]:>25s} ({int(row["year"])}) {row["primary_position"]:>4s}: '
              f'{row["cur_ss"]:.1f} -> {row["new_ss"]:.1f} ({row["delta_ss"]:+.1f})  [{stats}]')

    print(f'\n  --- {label} LOSERS (top 15) ---')
    top_down = df.nsmallest(15, 'delta_ss')
    for _, row in top_down.iterrows():
        stats = ' '.join([f'{row[c]:.0f}' if c not in ['ERA', 'WHIP', 'AVG'] else f'{row[c]:.2f}' for c in stat_cols])
        print(f'    {row["name"]:>25s} ({int(row["year"])}) {row["primary_position"]:>4s}: '
              f'{row["cur_ss"]:.1f} -> {row["new_ss"]:.1f} ({row["delta_ss"]:+.1f})  [{stats}]')


# Score shift scatter plot
fig, axes = plt.subplots(1, 2, figsize=(16, 7))

for ax, label, df in [(axes[0], 'Batters', bat), (axes[1], 'Pitchers', pit)]:
    for pos in sorted(df['primary_position'].unique()):
        mask = df['primary_position'] == pos
        ax.scatter(df.loc[mask, 'cur_ss'], df.loc[mask, 'new_ss'],
                  alpha=0.3, s=10, label=pos)
    ax.plot([1, 10], [1, 10], 'k--', alpha=0.3, label='No change')
    ax.set_xlabel('Current Sandlot Score')
    ax.set_ylabel('New Sandlot Score')
    ax.set_title(f'{label}: Score Shifts (Enriched Model)')
    ax.legend(fontsize=8, loc='lower right')
    ax.set_xlim(0.5, 10.5)
    ax.set_ylim(0.5, 10.5)

plt.tight_layout()
plt.savefig(OUT_DIR / 'score_shifts_enriched.png', dpi=150, bbox_inches='tight')
print('\nSaved score_shifts_enriched.png')

print('\n' + '='*70)
print('ANALYSIS COMPLETE')
print('='*70)
