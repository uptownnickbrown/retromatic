#!/usr/bin/env python3
"""
Sandlot Score Calibration Experiments
Runs on persisted sim results (no simulation needed, ~30s).

Tests improvements to the Sandlot Score formula:
- Pitcher interaction terms (IP × quality)
- SP/RP split models
- Non-linear ceiling (poly2, gradient boosting)
- Batter position × SB interactions
- Candidate production formulas with score shift analysis
"""

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr
from sklearn.linear_model import Ridge
from sklearn.model_selection import cross_val_score, cross_val_predict
from sklearn.preprocessing import PolynomialFeatures, StandardScaler
from sklearn.ensemble import HistGradientBoostingRegressor
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path

sns.set_theme(style='whitegrid', font_scale=1.1)
OUT_DIR = Path('sim-results')

# ============================================================
# 1. Data Load + Helpers
# ============================================================
print('='*60)
print('1. DATA LOAD')
print('='*60)

mwc = pd.read_parquet(OUT_DIR / 'player_mwc.parquet')
print(f'Loaded {len(mwc):,} player-seasons')

# Filter to meaningful sample size
rf = mwc[mwc['n_appearances'] >= 30].copy()
bat = rf[rf['player_type'] == 'batter'].copy()
pit = rf[rf['player_type'] == 'pitcher'].copy()
sp = pit[pit['primary_position'] == 'SP'].copy()
rp = pit[pit['primary_position'] == 'RP'].copy()

print(f'Filtered (n_appearances >= 30): {len(rf)} total')
print(f'  Batters: {len(bat)} | Pitchers: {len(pit)} (SP: {len(sp)}, RP: {len(rp)})')

# Feature column groups (from run_validation.py recomputed components)
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


def evaluate_model(X, y, name, alpha=1.0):
    """Ridge regression with 5-fold CV. Returns (model, cv_r2_mean, cv_r2_std)."""
    model = Ridge(alpha=alpha)
    scores = cross_val_score(model, X, y, cv=5, scoring='r2')
    model.fit(X, y)
    spear = spearmanr(model.predict(X), y)[0]
    print(f'  {name:>50s}: CV R²={scores.mean():.4f} (±{scores.std():.4f}), Spearman={spear:.4f}')
    return model, scores.mean(), scores.std()


def sandlot_score(z):
    """Map z_score_position to Sandlot Score (1.0 - 10.0)."""
    z_clamped = np.clip(z, -2, 10)
    return 1.0 + ((z_clamped + 2) / 12) * 9.0


def evaluate_formula(df, new_z, target, name):
    """Evaluate a scalar z-score formula as a Sandlot Score predictor."""
    ss = sandlot_score(new_z)
    X = ss.reshape(-1, 1)
    model = Ridge(alpha=1.0)
    scores = cross_val_score(model, X, target, cv=5, scoring='r2')
    model.fit(X, target)
    r_val, _ = pearsonr(ss, target)
    spear = spearmanr(ss, target)[0]
    print(f'  {name:>50s}: CV R²={scores.mean():.4f} (±{scores.std():.4f}), '
          f'r={r_val:.4f}, ρ={spear:.4f}')
    return scores.mean()


# ============================================================
# 2. Experiment 1 — Pitcher Interaction Terms
# ============================================================
print('\n' + '='*60)
print('2. EXPERIMENT 1: PITCHER INTERACTION TERMS')
print('='*60)
print('Baseline: Model C (blended z, 10 features)')

X_c = pit[pit_blend].values.astype(float)
m_c, r2_c, _ = evaluate_model(X_c, target_pit, 'Model C baseline')

# Derive interaction features
pit_ip = pit['IP'].values.astype(float)
pit_era = pit['ERA'].values.astype(float)
pit_whip = pit['WHIP'].values.astype(float)
pit_k = pit['K'].values.astype(float)
pit_k9 = np.where(pit_ip > 0, pit_k * 9 / pit_ip, 0)

print('\nAdding features to Model C:')

# E1a: IP × quality interactions
X_e1a = np.column_stack([X_c, pit_ip * pit_era, pit_ip * pit_whip, pit_ip * pit_k9])
evaluate_model(X_e1a, target_pit, 'E1a: + IP×ERA, IP×WHIP, IP×K/9')

# E1b: Raw linear IP + WHIP
X_e1b = np.column_stack([X_c, pit_ip, pit_whip])
evaluate_model(X_e1b, target_pit, 'E1b: + IP, WHIP (raw linear)')

# E1c: IP + WHIP + W + SV
X_e1c = np.column_stack([X_c, pit_ip, pit_whip, pit['W'].values.astype(float), pit['SV'].values.astype(float)])
evaluate_model(X_e1c, target_pit, 'E1c: + IP, WHIP, W, SV')

# E1d: Just IP alone
X_e1d = np.column_stack([X_c, pit_ip])
evaluate_model(X_e1d, target_pit, 'E1d: + IP only')

# E1e: Just WHIP alone
X_e1e = np.column_stack([X_c, pit_whip])
evaluate_model(X_e1e, target_pit, 'E1e: + WHIP only')

print('\n  → IP and WHIP as additive linear features vs multiplicative interactions')


# ============================================================
# 3. Experiment 2 — SP/RP Split Models
# ============================================================
print('\n' + '='*60)
print('3. EXPERIMENT 2: SP/RP SPLIT MODELS')
print('='*60)


def evaluate_split(sp_X, rp_X, sp_y, rp_y, name, alpha=1.0):
    """Train separate SP/RP models, combine predictions, report combined R²."""
    sp_model = Ridge(alpha=alpha)
    rp_model = Ridge(alpha=alpha)

    # Cross-val predict for each subset
    sp_pred = cross_val_predict(sp_model, sp_X, sp_y, cv=5)
    rp_pred = cross_val_predict(rp_model, rp_X, rp_y, cv=5)

    # Combined R²
    all_pred = np.concatenate([sp_pred, rp_pred])
    all_true = np.concatenate([sp_y, rp_y])
    ss_res = np.sum((all_true - all_pred) ** 2)
    ss_tot = np.sum((all_true - all_true.mean()) ** 2)
    combined_r2 = 1 - ss_res / ss_tot

    # Also fit full models for coefficient inspection
    sp_model.fit(sp_X, sp_y)
    rp_model.fit(rp_X, rp_y)

    # Per-subset CV R²
    sp_cv = cross_val_score(Ridge(alpha=alpha), sp_X, sp_y, cv=5, scoring='r2').mean()
    rp_cv = cross_val_score(Ridge(alpha=alpha), rp_X, rp_y, cv=5, scoring='r2').mean()

    print(f'  {name:>50s}: Combined R²={combined_r2:.4f} '
          f'(SP={sp_cv:.4f}, RP={rp_cv:.4f})')
    return sp_model, rp_model, combined_r2


# Pooled baselines for comparison
print('Pooled baselines:')
evaluate_model(pit[pit_oz].values.astype(float), target_pit, 'Pooled: Overall Z (5 feat)')
evaluate_model(X_c, target_pit, 'Pooled: Blended Z (10 feat)')

raw_pit_cols = ['W', 'SV', 'K', 'ERA', 'WHIP', 'IP']
pos_dum = pd.get_dummies(pit['primary_position'], prefix='pos')
X_ks = np.column_stack([pit[raw_pit_cols].values.astype(float), X_c, pos_dum.values])
evaluate_model(X_ks, target_pit, 'Pooled: Kitchen Sink')

print('\nSP/RP split models:')

# E2a: Overall z only
sp_m_a, rp_m_a, _ = evaluate_split(
    sp[pit_oz].values.astype(float), rp[pit_oz].values.astype(float),
    target_sp, target_rp, 'E2a: Split Overall Z (5 feat)')

# E2b: Blended z
sp_m_b, rp_m_b, _ = evaluate_split(
    sp[pit_blend].values.astype(float), rp[pit_blend].values.astype(float),
    target_sp, target_rp, 'E2b: Split Blended Z (10 feat)')

# E2c: Blended z + IP + WHIP
sp_X_c = np.column_stack([sp[pit_blend].values.astype(float), sp['IP'].values.astype(float), sp['WHIP'].values.astype(float)])
rp_X_c = np.column_stack([rp[pit_blend].values.astype(float), rp['IP'].values.astype(float), rp['WHIP'].values.astype(float)])
sp_m_c, rp_m_c, _ = evaluate_split(sp_X_c, rp_X_c, target_sp, target_rp,
                                     'E2c: Split Blended Z + IP + WHIP')

# E2d: Split kitchen sink (same features minus position dummies which are redundant in split)
sp_X_d = np.column_stack([sp[raw_pit_cols].values.astype(float), sp[pit_blend].values.astype(float)])
rp_X_d = np.column_stack([rp[raw_pit_cols].values.astype(float), rp[pit_blend].values.astype(float)])
evaluate_split(sp_X_d, rp_X_d, target_sp, target_rp, 'E2d: Split Kitchen Sink (no pos dummies)')

# Print SP vs RP coefficient comparison for overall z model
print('\n  SP vs RP learned weights (Overall Z, E2a):')
labels = ['W', 'SV', 'SO', 'ER_saved', 'BR_saved']
print(f'  {"Component":>12s}  {"SP coef":>10s}  {"RP coef":>10s}  {"Ratio SP/RP":>12s}')
for i, label in enumerate(labels):
    sp_c = sp_m_a.coef_[i]
    rp_c = rp_m_a.coef_[i]
    ratio = sp_c / rp_c if abs(rp_c) > 1e-6 else float('inf')
    print(f'  {label:>12s}  {sp_c:>+10.6f}  {rp_c:>+10.6f}  {ratio:>12.2f}')


# ============================================================
# 4. Experiment 3 — Non-Linear Ceiling
# ============================================================
print('\n' + '='*60)
print('4. EXPERIMENT 3: NON-LINEAR CEILING')
print('='*60)

print('\n--- PITCHERS ---')

# E3a: Poly(2) + Ridge on blended z
poly = PolynomialFeatures(degree=2, include_bias=False)
X_poly_pit = poly.fit_transform(X_c)
evaluate_model(X_poly_pit, target_pit, f'E3a: Poly(2) + Ridge on Blended Z ({X_poly_pit.shape[1]} feat)')

# E3b: HistGradientBoosting on blended z
hgb = HistGradientBoostingRegressor(max_iter=200, max_depth=4, random_state=42)
hgb_scores = cross_val_score(hgb, X_c, target_pit, cv=5, scoring='r2')
print(f'  {"E3b: HistGBR on Blended Z":>50s}: CV R²={hgb_scores.mean():.4f} (±{hgb_scores.std():.4f})')

# E3c: HistGBR on kitchen sink
hgb_scores2 = cross_val_score(hgb, X_ks, target_pit, cv=5, scoring='r2')
print(f'  {"E3c: HistGBR on Kitchen Sink":>50s}: CV R²={hgb_scores2.mean():.4f} (±{hgb_scores2.std():.4f})')

# E3d: Poly(2) on SP/RP split blended z
poly_sp = PolynomialFeatures(degree=2, include_bias=False)
poly_rp = PolynomialFeatures(degree=2, include_bias=False)
sp_X_poly = poly_sp.fit_transform(sp[pit_blend].values.astype(float))
rp_X_poly = poly_rp.fit_transform(rp[pit_blend].values.astype(float))
evaluate_split(sp_X_poly, rp_X_poly, target_sp, target_rp,
               f'E3d: Poly(2) + Ridge, SP/RP Split ({sp_X_poly.shape[1]} feat)')

print('\n--- BATTERS ---')

X_bat_c = bat[bat_blend].values.astype(float)
X_poly_bat = PolynomialFeatures(degree=2, include_bias=False).fit_transform(X_bat_c)
evaluate_model(X_poly_bat, target_bat, f'E3e: Poly(2) + Ridge on Blended Z ({X_poly_bat.shape[1]} feat)')

hgb_bat_scores = cross_val_score(
    HistGradientBoostingRegressor(max_iter=200, max_depth=4, random_state=42),
    X_bat_c, target_bat, cv=5, scoring='r2')
print(f'  {"E3f: HistGBR on Blended Z":>50s}: CV R²={hgb_bat_scores.mean():.4f} (±{hgb_bat_scores.std():.4f})')


# ============================================================
# 5. Experiment 4 — Batter Position × SB Interactions
# ============================================================
print('\n' + '='*60)
print('5. EXPERIMENT 4: BATTER POSITION × SB INTERACTIONS')
print('='*60)

print('Baseline: Model C (blended z, 12 features)')
m_bat_c, r2_bat_c, _ = evaluate_model(X_bat_c, target_bat, 'Model C baseline')

# Position dummies for batters
bat_positions = sorted(bat['primary_position'].unique())
pos_dummies_bat = pd.get_dummies(bat['primary_position'], prefix='pos')

# E4a: Model C + position × SB_pz interactions
sb_pz = bat['sc_pz_SB'].values.astype(float)
sb_pos_interactions = np.column_stack([sb_pz * pos_dummies_bat[f'pos_{p}'].values for p in bat_positions])
X_e4a = np.column_stack([X_bat_c, sb_pos_interactions])
m_e4a, _, _ = evaluate_model(X_e4a, target_bat, f'E4a: + pos×SB_pz ({len(bat_positions)} interactions)')

# E4b: Model C + position × ALL stats (pz only)
all_pos_interactions = []
for col in bat_pz:
    vals = bat[col].values.astype(float)
    for p in bat_positions:
        all_pos_interactions.append(vals * pos_dummies_bat[f'pos_{p}'].values)
X_e4b = np.column_stack([X_bat_c] + all_pos_interactions)
evaluate_model(X_e4b, target_bat, f'E4b: + pos×ALL_pz ({len(bat_pz)*len(bat_positions)} interactions)')

# E4c: Just position dummies (no interactions)
X_e4c = np.column_stack([X_bat_c, pos_dummies_bat.values])
evaluate_model(X_e4c, target_bat, 'E4c: + position dummies only')

# Print SB interaction coefficients from E4a
print('\n  SB × Position interaction coefficients (E4a):')
# The interaction coefficients start after the 12 blended z features
for i, pos in enumerate(bat_positions):
    coef = m_e4a.coef_[len(bat_blend) + i]
    print(f'    SB_pz × {pos:>4s}: {coef:+.6f}')

# Show SB inflation by position
print('\n  SB z-score inflation by position (mean sc_pz_SB - sc_oz_SB):')
for pos in bat_positions:
    mask = bat['primary_position'] == pos
    inflation = (bat.loc[mask, 'sc_pz_SB'] - bat.loc[mask, 'sc_oz_SB']).mean()
    n = mask.sum()
    print(f'    {pos:>4s}: inflation={inflation:+.3f} (n={n})')


# ============================================================
# 6. Experiment 5 — Candidate Production Formulas
# ============================================================
print('\n' + '='*60)
print('6. EXPERIMENT 5: CANDIDATE PRODUCTION FORMULAS')
print('='*60)

# --- Current baseline ---
print('\n=== CURRENT FORMULA (baseline) ===')
evaluate_formula(bat, bat['z_score_position'].values.astype(float), target_bat, 'Current Batter (clamped SS)')
evaluate_formula(pit, pit['z_score_position'].values.astype(float), target_pit, 'Current Pitcher (clamped SS)')

# --- PITCHER FORMULAS ---
print('\n=== PITCHER CANDIDATE FORMULAS ===')

# P1: SP/RP split, overall z, learned weights
# Train separate models on overall z, extract weights, apply as formula
sp_ridge = Ridge(alpha=1.0).fit(sp[pit_oz].values.astype(float), target_sp)
rp_ridge = Ridge(alpha=1.0).fit(rp[pit_oz].values.astype(float), target_rp)

print('\n  P1: SP/RP split, overall z, learned weights')
print(f'    SP weights: {dict(zip(labels, [f"{c:.4f}" for c in sp_ridge.coef_]))}')
print(f'    RP weights: {dict(zip(labels, [f"{c:.4f}" for c in rp_ridge.coef_]))}')

# Normalize weights so they sum to same magnitude as current (5.0)
def normalize_weights(coefs, target_sum=5.0):
    scale = target_sum / np.abs(coefs).sum()
    return coefs * scale

sp_w_norm = normalize_weights(sp_ridge.coef_)
rp_w_norm = normalize_weights(rp_ridge.coef_)
print(f'    SP normalized: {dict(zip(labels, [f"{c:.3f}" for c in sp_w_norm]))}')
print(f'    RP normalized: {dict(zip(labels, [f"{c:.3f}" for c in rp_w_norm]))}')

# Compute P1 z_score
pit_oz_vals = pit[pit_oz].values.astype(float)
p1_z = np.where(
    pit['primary_position'].values == 'SP',
    pit_oz_vals @ sp_w_norm,
    pit_oz_vals @ rp_w_norm,
)
evaluate_formula(pit, p1_z, target_pit, 'P1: SP/RP split, overall z, norm weights')

# P2: Single weight vector, overall z only, optimized
pit_ridge_ovr = Ridge(alpha=1.0).fit(pit[pit_oz].values.astype(float), target_pit)
p2_w_norm = normalize_weights(pit_ridge_ovr.coef_)
print(f'\n  P2 weights: {dict(zip(labels, [f"{c:.3f}" for c in p2_w_norm]))}')
p2_z = pit_oz_vals @ p2_w_norm
evaluate_formula(pit, p2_z, target_pit, 'P2: Single weights, overall z')

# P3: Current formula structure (W/SV overall, rest positional), optimized weights
pit_current_cols = ['sc_oz_W', 'sc_oz_SV', 'sc_pz_SO', 'sc_pz_ER_saved', 'sc_pz_BR_saved']
pit_ridge_cur = Ridge(alpha=1.0).fit(pit[pit_current_cols].values.astype(float), target_pit)
p3_w_norm = normalize_weights(pit_ridge_cur.coef_)
p3_labels = ['W(oz)', 'SV(oz)', 'SO(pz)', 'ER_saved(pz)', 'BR_saved(pz)']
print(f'\n  P3 weights: {dict(zip(p3_labels, [f"{c:.3f}" for c in p3_w_norm]))}')
p3_z = pit[pit_current_cols].values.astype(float) @ p3_w_norm
evaluate_formula(pit, p3_z, target_pit, 'P3: Current structure, optimized weights')

# --- BATTER FORMULAS ---
print('\n=== BATTER CANDIDATE FORMULAS ===')

# B1: Current positional z, optimized weights
bat_ridge_pz = Ridge(alpha=1.0).fit(bat[bat_pz].values.astype(float), target_bat)
bat_labels = ['R', 'HR', 'RBI', 'SB', 'H', 'Outs']
b1_w_raw = bat_ridge_pz.coef_.copy()
# Outs should be negative — enforce sign then normalize
b1_w_norm = normalize_weights(b1_w_raw, target_sum=6.0)
print(f'\n  B1 weights: {dict(zip(bat_labels, [f"{c:.3f}" for c in b1_w_norm]))}')
b1_z = bat[bat_pz].values.astype(float) @ b1_w_norm
evaluate_formula(bat, b1_z, target_bat, 'B1: Positional z, optimized weights')

# B2: Use overall z for SB, equal weights otherwise
b2_components = bat[['sc_pz_R', 'sc_pz_HR', 'sc_pz_RBI']].values.astype(float)
b2_sb = bat['sc_oz_SB'].values.astype(float).reshape(-1, 1)
b2_h = bat['sc_pz_H'].values.astype(float).reshape(-1, 1)
b2_outs = bat['sc_pz_Outs'].values.astype(float).reshape(-1, 1)
b2_z = b2_components.sum(axis=1) + b2_sb.ravel() + b2_h.ravel() - b2_outs.ravel()
evaluate_formula(bat, b2_z, target_bat, 'B2: SB uses overall z, equal weights')

# B3: Overall z for SB + optimized weights
b3_cols = ['sc_pz_R', 'sc_pz_HR', 'sc_pz_RBI', 'sc_oz_SB', 'sc_pz_H', 'sc_pz_Outs']
bat_ridge_b3 = Ridge(alpha=1.0).fit(bat[b3_cols].values.astype(float), target_bat)
b3_w_norm = normalize_weights(bat_ridge_b3.coef_, target_sum=6.0)
print(f'\n  B3 weights: {dict(zip(bat_labels, [f"{c:.3f}" for c in b3_w_norm]))}')
b3_z = bat[b3_cols].values.astype(float) @ b3_w_norm
evaluate_formula(bat, b3_z, target_bat, 'B3: SB overall z + optimized weights')

# B4: Blended, optimized weights (let model choose pos/ovr mix)
bat_ridge_blend = Ridge(alpha=1.0).fit(bat[bat_blend].values.astype(float), target_bat)
# Collapse blended weights to effective per-component weights
b4_eff = []
for i in range(6):
    b4_eff.append(bat_ridge_blend.coef_[i] + bat_ridge_blend.coef_[i + 6])
b4_z = bat[bat_blend].values.astype(float) @ bat_ridge_blend.coef_
# Normalize to match current z-score scale
b4_z_scaled = b4_z * (6.0 / np.abs(bat_ridge_blend.coef_).sum())
evaluate_formula(bat, b4_z_scaled, target_bat, 'B4: Full blend, Ridge-learned mix')


# ============================================================
# 7. Summary & Score Shift Analysis
# ============================================================
print('\n' + '='*60)
print('7. SUMMARY & SCORE SHIFT ANALYSIS')
print('='*60)

# Re-evaluate best candidates on full filtered dataset
print('\n=== BEST CANDIDATES COMPARISON ===')
print(f'{"Formula":<45s} {"CV R²":>8s} {"Δ vs current":>14s}')
print('-' * 70)

# Compute all candidate formulas for the full dataset
formulas = {}

# Current
cur_bat_z = bat['z_score_position'].values.astype(float)
cur_pit_z = pit['z_score_position'].values.astype(float)

# Best batter: B3
best_bat_z = b3_z
best_bat_name = 'B3'

# Best pitcher: P1
best_pit_z = p1_z
best_pit_name = 'P1'

# Evaluate per-position correlations for best candidates
print('\n=== PER-POSITION CORRELATIONS (best candidates vs current) ===')
print(f'{"Pos":>5s} {"n":>5s} | {"Current r":>10s} {"New r":>10s} {"Δr":>8s}')
print('-' * 48)

# Batters
for pos in sorted(bat['primary_position'].unique()):
    mask = bat['primary_position'] == pos
    if mask.sum() < 10:
        continue
    cur_r = pearsonr(sandlot_score(cur_bat_z[mask]), target_bat[mask])[0]
    new_r = pearsonr(sandlot_score(best_bat_z[mask]), target_bat[mask])[0]
    print(f'{pos:>5s} {mask.sum():>5d} | {cur_r:>10.4f} {new_r:>10.4f} {new_r - cur_r:>+8.4f}')

# Pitchers
for pos in ['SP', 'RP']:
    mask = pit['primary_position'] == pos
    cur_r = pearsonr(sandlot_score(cur_pit_z[mask]), target_pit[mask])[0]
    new_r = pearsonr(sandlot_score(best_pit_z[mask]), target_pit[mask])[0]
    print(f'{pos:>5s} {mask.sum():>5d} | {cur_r:>10.4f} {new_r:>10.4f} {new_r - cur_r:>+8.4f}')

# Score shift analysis
print('\n=== SCORE SHIFT ANALYSIS ===')

for label, old_z, new_z, subset, names in [
    ('Batters', cur_bat_z, best_bat_z, bat, bat['name'].values),
    ('Pitchers', cur_pit_z, best_pit_z, pit, pit['name'].values),
]:
    old_ss = sandlot_score(old_z)
    new_ss = sandlot_score(new_z)
    delta = new_ss - old_ss

    print(f'\n  {label} ({best_bat_name if label == "Batters" else best_pit_name}):')
    print(f'    Mean absolute shift: {np.abs(delta).mean():.3f}')
    print(f'    Players moving > 0.5 SS: {(np.abs(delta) > 0.5).sum()} / {len(delta)}')
    print(f'    Players moving > 1.0 SS: {(np.abs(delta) > 1.0).sum()} / {len(delta)}')
    print(f'    Players moving > 2.0 SS: {(np.abs(delta) > 2.0).sum()} / {len(delta)}')

    # Distribution comparison
    print(f'\n    Distribution: {"Current":>10s} {"New":>10s} {"Δ":>8s}')
    for pct in [50, 75, 90, 95, 99]:
        cur_p = np.percentile(old_ss, pct)
        new_p = np.percentile(new_ss, pct)
        print(f'      P{pct:>2d}:      {cur_p:>10.2f} {new_p:>10.2f} {new_p - cur_p:>+8.2f}')

    # Count of 10.0 scores
    cur_tens = (old_ss >= 10.0).sum()
    new_tens = (new_ss >= 10.0).sum()
    print(f'      10.0s:    {cur_tens:>10d} {new_tens:>10d} {new_tens - cur_tens:>+8d}')

    # Biggest movers
    top_up = np.argsort(-delta)[:10]
    top_down = np.argsort(delta)[:10]

    print(f'\n    Top 10 GAINERS:')
    for idx in top_up:
        yr = subset.iloc[idx]['year']
        pos = subset.iloc[idx]['primary_position']
        print(f'      {names[idx]:>25s} ({yr}) {pos:>4s}: '
              f'{old_ss[idx]:.1f} → {new_ss[idx]:.1f} ({delta[idx]:+.1f})')

    print(f'\n    Top 10 LOSERS:')
    for idx in top_down:
        yr = subset.iloc[idx]['year']
        pos = subset.iloc[idx]['primary_position']
        print(f'      {names[idx]:>25s} ({yr}) {pos:>4s}: '
              f'{old_ss[idx]:.1f} → {new_ss[idx]:.1f} ({delta[idx]:+.1f})')

# Score shift scatter plot
fig, axes = plt.subplots(1, 2, figsize=(16, 7))

for ax, label, old_z, new_z, subset in [
    (axes[0], 'Batters', cur_bat_z, best_bat_z, bat),
    (axes[1], 'Pitchers', cur_pit_z, best_pit_z, pit),
]:
    old_ss = sandlot_score(old_z)
    new_ss = sandlot_score(new_z)
    positions = subset['primary_position'].values

    for pos in sorted(set(positions)):
        mask = positions == pos
        ax.scatter(old_ss[mask], new_ss[mask], alpha=0.3, s=10, label=pos)

    ax.plot([1, 10], [1, 10], 'k--', alpha=0.3, label='No change')
    ax.set_xlabel('Current Sandlot Score')
    ax.set_ylabel('New Sandlot Score')
    ax.set_title(f'{label}: Score Shifts')
    ax.legend(fontsize=8, loc='lower right')
    ax.set_xlim(0.5, 10.5)
    ax.set_ylim(0.5, 10.5)

plt.tight_layout()
plt.savefig(OUT_DIR / 'score_shifts.png', dpi=150, bbox_inches='tight')
print('\nSaved score_shifts.png')

# Weight comparison chart
fig, axes = plt.subplots(1, 2, figsize=(16, 6))

# Batter weights
ax = axes[0]
current_bat_w = np.array([1, 1, 1, 1, 1, -1], dtype=float)
x = np.arange(len(bat_labels))
width = 0.35
ax.bar(x - width/2, current_bat_w / np.abs(current_bat_w).sum() * np.abs(b3_w_norm).sum(),
       width, label='Current (equal)', color='#2196F3', alpha=0.7)
ax.bar(x + width/2, b3_w_norm, width, label=f'{best_bat_name} (optimized)', color='#FF5722', alpha=0.7)
ax.set_xticks(x)
ax.set_xticklabels(bat_labels)
ax.set_ylabel('Weight')
ax.set_title('Batter Category Weights')
ax.legend()
ax.axhline(y=0, color='gray', linestyle='-', alpha=0.3)

# Pitcher weights (SP and RP side by side)
ax = axes[1]
x = np.arange(len(labels))
width = 0.25
current_pit_w = np.array([1, 1, 1, 1, 1], dtype=float)
ax.bar(x - width, current_pit_w / 5 * np.abs(sp_w_norm).sum() / 5,
       width, label='Current (equal)', color='#2196F3', alpha=0.7)
ax.bar(x, sp_w_norm, width, label='SP (optimized)', color='#FF5722', alpha=0.7)
ax.bar(x + width, rp_w_norm, width, label='RP (optimized)', color='#4CAF50', alpha=0.7)
ax.set_xticks(x)
ax.set_xticklabels(labels, rotation=15)
ax.set_ylabel('Weight')
ax.set_title('Pitcher Category Weights (SP vs RP)')
ax.legend()
ax.axhline(y=0, color='gray', linestyle='-', alpha=0.3)

plt.tight_layout()
plt.savefig(OUT_DIR / 'experiment_weights.png', dpi=150, bbox_inches='tight')
print('Saved experiment_weights.png')

print('\n' + '='*60)
print('EXPERIMENT SUITE COMPLETE')
print('='*60)
