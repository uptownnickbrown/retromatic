#!/usr/bin/env python3
"""
Sandlot Score Validation Study — Script runner
Executes all notebook cells as a script for environments where nbconvert has issues.
"""

import numpy as np
import pandas as pd
import json
from scipy.stats import rankdata, pearsonr, spearmanr, zscore as scipy_zscore
from sklearn.linear_model import Ridge, LinearRegression
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import StandardScaler
import matplotlib
matplotlib.use('Agg')  # non-interactive backend
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
import time

sns.set_theme(style='whitegrid', font_scale=1.1)
SIM_RESULTS_DIR = Path('sim-results')
SIM_RESULTS_DIR.mkdir(exist_ok=True)

np.random.seed(42)
print('Setup complete')

# ============================================================
# 1. Data Load
# ============================================================
print('\n' + '='*60)
print('1. DATA LOAD')
print('='*60)

PARQUET_FILE = Path('sim-data/players.parquet')
if not PARQUET_FILE.exists():
    print(f'ERROR: {PARQUET_FILE} not found. Run pull_player_data.py first:')
    print('  railway service Postgres && railway run python pull_player_data.py')
    raise SystemExit(1)

df = pd.read_parquet(PARQUET_FILE)

print(f'Loaded {len(df)} player-seasons')
print(f'Player types: {df.player_type.value_counts().to_dict()}')
print(f'Positions: {df.primary_position.value_counts().to_dict()}')

# ============================================================
# 2. Data Preparation
# ============================================================
print('\n' + '='*60)
print('2. DATA PREPARATION')
print('='*60)

def parse_stats(row):
    stats = row['stats'] if isinstance(row['stats'], dict) else json.loads(row['stats'])
    pt = row['player_type']
    if pt == 'batter':
        return pd.Series({
            'R': stats.get('R', 0),
            'HR': stats.get('HR', 0),
            'RBI': stats.get('RBI', 0),
            'SB': stats.get('SB', 0),
            'H': stats.get('H', 0),
            'AB': stats.get('AB', 1),
            'AVG': stats.get('AVG', 0.0),
            'BB_bat': stats.get('BB', 0),
            'W': 0, 'SV': 0, 'K': 0, 'ERA': 0.0, 'WHIP': 0.0,
            'IP': 0.0, 'ER': 0, 'P_H': 0, 'P_BB': 0,
        })
    else:
        return pd.Series({
            'R': 0, 'HR': 0, 'RBI': 0, 'SB': 0, 'H': 0, 'AB': 0, 'AVG': 0.0, 'BB_bat': 0,
            'W': stats.get('W', 0),
            'SV': stats.get('SV', 0),
            'K': stats.get('SO', stats.get('K', 0)),
            'ERA': stats.get('ERA', 0.0),
            'WHIP': stats.get('WHIP', 0.0),
            'IP': stats.get('IP', 0.0),
            'ER': stats.get('ER', 0),
            'P_H': stats.get('H', 0),
            'P_BB': stats.get('BB', 0),
        })

stat_cols = df.apply(parse_stats, axis=1)
df = pd.concat([df, stat_cols], axis=1)

def parse_cat_z(row):
    cz = row['category_zscores'] if isinstance(row['category_zscores'], dict) else json.loads(row['category_zscores'])
    pt = row['player_type']
    if pt == 'batter':
        return pd.Series({
            'cz_R': cz.get('R', 0), 'cz_HR': cz.get('HR', 0),
            'cz_RBI': cz.get('RBI', 0), 'cz_SB': cz.get('SB', 0),
            'cz_H': cz.get('H', 0), 'cz_AVG': cz.get('AVG', 0),
            'cz_W': 0, 'cz_SV': 0, 'cz_K': 0, 'cz_ERA': 0, 'cz_WHIP': 0,
        })
    else:
        return pd.Series({
            'cz_R': 0, 'cz_HR': 0, 'cz_RBI': 0, 'cz_SB': 0, 'cz_H': 0, 'cz_AVG': 0,
            'cz_W': cz.get('W', 0), 'cz_SV': cz.get('SV', 0),
            'cz_K': cz.get('K', cz.get('SO', 0)),
            'cz_ERA': cz.get('ERA', 0), 'cz_WHIP': cz.get('WHIP', 0),
        })

cat_z_cols = df.apply(parse_cat_z, axis=1)
df = pd.concat([df, cat_z_cols], axis=1)

df['pos_set'] = df['positions_eligible'].apply(lambda x: set(x.split(',')) if pd.notna(x) else set())

def sandlot_score(z):
    z_clamped = np.clip(z, -2, 10)
    return 1.0 + ((z_clamped + 2) / 12) * 9.0

df['sandlot_score'] = df['z_score_position'].astype(float).apply(sandlot_score)
df['z_score_position'] = df['z_score_position'].astype(float)
df['z_score_overall'] = df['z_score_overall'].astype(float)
df['name'] = df['name_first'] + ' ' + df['name_last']

print(f'Batters: {(df.player_type == "batter").sum()}')
print(f'Pitchers: {(df.player_type == "pitcher").sum()}')
print(f'\nSandlot Score distribution:')
print(df['sandlot_score'].describe())

# ============================================================
# 2.5. Recompute Actual Scoring Components from Raw Stats
# ============================================================
# The DB category_zscores are DISPLAY z-scores (for percentile bars), NOT
# the actual scoring components. We need the real ones for model comparison.
# Must match data-pipeline/preprocess-to-postgres.py exactly.
print('\n' + '='*60)
print('2.5. RECOMPUTE SCORING Z-SCORES')
print('='*60)

batters = df[df['player_type'] == 'batter'].copy()
pitchers = df[df['player_type'] == 'pitcher'].copy()

# --- BATTERS ---
bat_counting = ['R', 'HR', 'RBI', 'SB', 'H']

# Cast stat columns to float upfront
for col in bat_counting:
    batters[col] = batters[col].astype(float)
batters['AB'] = batters['AB'].astype(float)
batters['Outs'] = batters['AB'] - batters['H']

# Overall z-scores (across all batters)
for col in bat_counting:
    batters[f'sc_oz_{col}'] = scipy_zscore(batters[col].fillna(0))
batters['sc_oz_Outs'] = scipy_zscore(batters['Outs'].fillna(0))

# Position-relative z-scores (within primary_position group)
for col in bat_counting + ['Outs']:
    batters[f'sc_pz_{col}'] = batters.groupby('primary_position')[col].transform(
        lambda s: scipy_zscore(s.fillna(0))
    )

# Fix UTIL: use overall z-scores (pool too small for position-relative)
util_mask = batters['primary_position'] == 'UTIL'
if util_mask.any():
    for col in bat_counting + ['Outs']:
        batters.loc[util_mask, f'sc_pz_{col}'] = batters.loc[util_mask, f'sc_oz_{col}']
    print(f'  Fixed {util_mask.sum()} UTIL batters to use overall z-scores')

# Recomputed composite
batters['sc_total_pos_z'] = (
    batters['sc_pz_R'] + batters['sc_pz_HR'] + batters['sc_pz_RBI']
    + batters['sc_pz_SB'] + batters['sc_pz_H'] - batters['sc_pz_Outs']
)

# Fill NaN
sc_cols = [c for c in batters.columns if c.startswith('sc_')]
for col in sc_cols:
    batters[col] = batters[col].fillna(0)

# --- PITCHERS ---
# Cast stat columns to float upfront
for col in ['W', 'SV', 'K', 'ERA', 'WHIP', 'IP']:
    pitchers[col] = pitchers[col].astype(float)

# Overall z-scores for W, SV, SO
for col in ['W', 'SV']:
    pitchers[f'sc_oz_{col}'] = scipy_zscore(pitchers[col].fillna(0))
pitchers['sc_oz_SO'] = scipy_zscore(pitchers['K'].fillna(0))

# ER_saved and BR_saved using OVERALL pool means
overall_mean_era = pitchers['ERA'].mean()
overall_mean_whip = pitchers['WHIP'].mean()
pitchers['ER_saved_overall'] = pitchers['IP'] * (overall_mean_era - pitchers['ERA']) / 9.0
pitchers['BR_saved_overall'] = pitchers['IP'] * (overall_mean_whip - pitchers['WHIP'])
pitchers['sc_oz_ER_saved'] = scipy_zscore(pitchers['ER_saved_overall'].fillna(0))
pitchers['sc_oz_BR_saved'] = scipy_zscore(pitchers['BR_saved_overall'].fillna(0))

# Position-relative z-scores for W, SV, SO
for col_raw, col_name in [('W', 'W'), ('SV', 'SV'), ('K', 'SO')]:
    pitchers[f'sc_pz_{col_name}'] = pitchers.groupby('primary_position')[col_raw].transform(
        lambda s: scipy_zscore(s.fillna(0))
    )

# ER_saved_POS and BR_saved_POS using POSITION-SPECIFIC pool means
pos_mean_era = pitchers.groupby('primary_position')['ERA'].transform('mean')
pos_mean_whip = pitchers.groupby('primary_position')['WHIP'].transform('mean')
pitchers['ER_saved_pos'] = pitchers['IP'] * (pos_mean_era - pitchers['ERA']) / 9.0
pitchers['BR_saved_pos'] = pitchers['IP'] * (pos_mean_whip - pitchers['WHIP'])

pitchers['sc_pz_ER_saved'] = pitchers.groupby('primary_position')['ER_saved_pos'].transform(
    lambda s: scipy_zscore(s.fillna(0))
)
pitchers['sc_pz_BR_saved'] = pitchers.groupby('primary_position')['BR_saved_pos'].transform(
    lambda s: scipy_zscore(s.fillna(0))
)

# Fix P pitchers: use overall z-scores (pool too small)
p_mask = pitchers['primary_position'] == 'P'
if p_mask.any():
    for sc_col in ['W', 'SV', 'SO', 'ER_saved', 'BR_saved']:
        pitchers.loc[p_mask, f'sc_pz_{sc_col}'] = pitchers.loc[p_mask, f'sc_oz_{sc_col}']
    print(f'  Fixed {p_mask.sum()} P pitchers to use overall z-scores')

# Pitcher composite: W_Z and SV_Z use OVERALL (not position-specific)
pitchers['sc_total_pos_z'] = (
    pitchers['sc_oz_W'] + pitchers['sc_oz_SV'] + pitchers['sc_pz_SO']
    + pitchers['sc_pz_ER_saved'] + pitchers['sc_pz_BR_saved']
)

# Fill NaN
sc_cols = [c for c in pitchers.columns if c.startswith('sc_')]
for col in sc_cols:
    pitchers[col] = pitchers[col].fillna(0)

# --- VALIDATION: Compare recomputed z-scores to DB values ---
for label, subset in [('Batters', batters), ('Pitchers', pitchers)]:
    db_z = subset['z_score_position'].astype(float).values
    recomp_z = subset['sc_total_pos_z'].values
    valid = np.isfinite(db_z) & np.isfinite(recomp_z)
    r_val, _ = pearsonr(db_z[valid], recomp_z[valid])
    diff = np.abs(db_z[valid] - recomp_z[valid])
    print(f'\n  {label} z-score recomputation validation:')
    print(f'    Pearson r = {r_val:.6f} (target: > 0.99)')
    print(f'    Mean abs diff = {diff.mean():.4f}, Max abs diff = {diff.max():.4f}')
    # Show top 10 worst matches
    worst_idx = np.argsort(-diff)[:10]
    subset_reset = subset.iloc[valid.nonzero()[0]]
    print(f'    Top 10 mismatches:')
    for wi in worst_idx:
        row = subset_reset.iloc[wi]
        print(f'      {row.get("name", "?")} ({row["year"]}) {row["primary_position"]}: '
              f'DB={db_z[valid][wi]:.3f}, Recomp={recomp_z[valid][wi]:.3f}, Diff={diff[wi]:.3f}')

# --- Merge scoring components back into main df ---
sc_bat_cols = [c for c in batters.columns if c.startswith('sc_')]
sc_pit_cols = [c for c in pitchers.columns if c.startswith('sc_')]
all_sc_cols = sorted(set(sc_bat_cols) | set(sc_pit_cols))

for col in all_sc_cols:
    df[col] = 0.0

for col in sc_bat_cols:
    df.loc[batters.index, col] = batters[col]
for col in sc_pit_cols:
    df.loc[pitchers.index, col] = pitchers[col]

print(f'\n  Merged {len(all_sc_cols)} scoring component columns into main df')

# ============================================================
# 3. Build Position Pools
# ============================================================
print('\n' + '='*60)
print('3. BUILD POSITION POOLS')
print('='*60)

ROSTER_SLOTS = [
    'C', 'SS', '2B', '3B', '1B',
    'OF', 'OF', 'OF',
    'UTIL',
    'SP', 'SP',
    'RP', 'RP',
    'P', 'P', 'P',
]

N_TEAMS = 12
N_LEAGUES = 10_000
N_SLOTS = len(ROSTER_SLOTS)

def is_eligible(pos_set, player_type, slot):
    if slot == 'UTIL':
        return player_type == 'batter'
    if slot == 'P':
        return player_type == 'pitcher'
    if slot == 'OF':
        return bool(pos_set & {'LF', 'CF', 'RF', 'OF'})
    if slot in ('SP', 'RP'):
        return slot in pos_set
    return slot in pos_set

slot_types = list(dict.fromkeys(ROSTER_SLOTS))
player_ids = df['id'].values
n_players = len(df)

eligibility = {}
for slot in slot_types:
    mask = df.apply(lambda r: is_eligible(r['pos_set'], r['player_type'], slot), axis=1).values
    eligible_idx = np.where(mask)[0]
    z_scores = df['z_score_position'].values[eligible_idx]
    weights = np.maximum(z_scores, 0.01) ** 2.5
    weights = weights / weights.sum()
    eligibility[slot] = {
        'indices': eligible_idx,
        'weights': weights,
    }
    print(f'{slot:>4s}: {len(eligible_idx):>6d} eligible players')

stats_R = df['R'].values.astype(np.float64)
stats_HR = df['HR'].values.astype(np.float64)
stats_RBI = df['RBI'].values.astype(np.float64)
stats_SB = df['SB'].values.astype(np.float64)
stats_H = df['H'].values.astype(np.float64)
stats_AB = df['AB'].values.astype(np.float64)
stats_W = df['W'].values.astype(np.float64)
stats_SV = df['SV'].values.astype(np.float64)
stats_K = df['K'].values.astype(np.float64)
stats_ER = df['ER'].values.astype(np.float64)
stats_IP = df['IP'].values.astype(np.float64)
stats_PH = df['P_H'].values.astype(np.float64)
stats_PBB = df['P_BB'].values.astype(np.float64)
z_pos = df['z_score_position'].values.astype(np.float64)

print(f'\nStat arrays built. Ready to simulate.')

# ============================================================
# 4. Simulation Engine
# ============================================================
print('\n' + '='*60)
print('4. SIMULATION ENGINE')
print('='*60)

def simulate_league(rng):
    rosters = np.zeros((N_TEAMS, N_SLOTS), dtype=np.int32)
    drafted = set()

    for slot_idx, slot in enumerate(ROSTER_SLOTS):
        elig = eligibility[slot]
        elig_indices = elig['indices']
        elig_weights = elig['weights'].copy()

        if slot_idx % 2 == 0:
            team_order = range(N_TEAMS)
        else:
            team_order = range(N_TEAMS - 1, -1, -1)

        for team_idx in team_order:
            available_mask = np.array([idx not in drafted for idx in elig_indices])
            if not available_mask.any():
                rosters[team_idx, slot_idx] = elig_indices[0]
                continue

            masked_weights = elig_weights * available_mask
            total = masked_weights.sum()
            if total <= 0:
                avail_idx = elig_indices[available_mask]
                pick = rng.choice(avail_idx)
            else:
                masked_weights /= total
                pick_pos = rng.choice(len(elig_indices), p=masked_weights)
                pick = elig_indices[pick_pos]

            rosters[team_idx, slot_idx] = pick
            drafted.add(pick)

    batter_slots = rosters[:, :9]
    pitcher_slots = rosters[:, 9:]

    team_R = stats_R[batter_slots].sum(axis=1)
    team_HR = stats_HR[batter_slots].sum(axis=1)
    team_RBI = stats_RBI[batter_slots].sum(axis=1)
    team_SB = stats_SB[batter_slots].sum(axis=1)
    team_W = stats_W[pitcher_slots].sum(axis=1)
    team_SV = stats_SV[pitcher_slots].sum(axis=1)
    team_K = stats_K[pitcher_slots].sum(axis=1)

    team_H = stats_H[batter_slots].sum(axis=1)
    team_AB = stats_AB[batter_slots].sum(axis=1)
    team_AVG = np.where(team_AB > 0, team_H / team_AB, 0.0)

    team_ER = stats_ER[pitcher_slots].sum(axis=1)
    team_IP = stats_IP[pitcher_slots].sum(axis=1)
    team_ERA = np.where(team_IP > 0, team_ER * 9 / team_IP, 99.0)

    team_PH = stats_PH[pitcher_slots].sum(axis=1)
    team_PBB = stats_PBB[pitcher_slots].sum(axis=1)
    team_WHIP = np.where(team_IP > 0, (team_PH + team_PBB) / team_IP, 99.0)

    ranks = np.zeros((N_TEAMS, 10))
    ranks[:, 0] = rankdata(team_R)
    ranks[:, 1] = rankdata(team_HR)
    ranks[:, 2] = rankdata(team_RBI)
    ranks[:, 3] = rankdata(team_SB)
    ranks[:, 4] = rankdata(team_AVG)
    ranks[:, 5] = rankdata(team_W)
    ranks[:, 6] = rankdata(team_SV)
    ranks[:, 7] = rankdata(team_K)
    ranks[:, 8] = rankdata(-team_ERA)
    ranks[:, 9] = rankdata(-team_WHIP)

    roto_points = ranks.sum(axis=1)
    finish_rank = rankdata(roto_points)
    finish_pct = (finish_rank - 1) / (N_TEAMS - 1)

    team_stats = np.column_stack([
        team_R, team_HR, team_RBI, team_SB, team_AVG,
        team_W, team_SV, team_K, team_ERA, team_WHIP,
        roto_points, finish_rank
    ])

    return rosters, finish_pct, team_stats

# Quick test
rng = np.random.default_rng(42)
test_rosters, test_fpct, test_tstats = simulate_league(rng)
print(f'Test league finish percentiles: {test_fpct}')
print(f'Test league roto points: {test_tstats[:, 10]}')

# ============================================================
# 5. Run Full Simulation
# ============================================================
print('\n' + '='*60)
print(f'5. RUNNING {N_LEAGUES:,} LEAGUES')
print('='*60)

start_time = time.time()

all_rosters = np.zeros((N_LEAGUES, N_TEAMS, N_SLOTS), dtype=np.int32)
all_finish_pct = np.zeros((N_LEAGUES, N_TEAMS), dtype=np.float64)
all_team_stats = np.zeros((N_LEAGUES, N_TEAMS, 12), dtype=np.float64)

rng = np.random.default_rng(42)

for league_idx in range(N_LEAGUES):
    rosters, finish_pct, team_stats = simulate_league(rng)
    all_rosters[league_idx] = rosters
    all_finish_pct[league_idx] = finish_pct
    all_team_stats[league_idx] = team_stats

    if (league_idx + 1) % 1000 == 0:
        elapsed = time.time() - start_time
        rate = (league_idx + 1) / elapsed
        eta = (N_LEAGUES - league_idx - 1) / rate
        print(f'  {league_idx + 1:>6,} / {N_LEAGUES:,} leagues ({rate:.1f}/sec, ETA {eta:.0f}s)')

total_time = time.time() - start_time
print(f'\nSimulation complete in {total_time:.1f}s')
print(f'Total draft picks: {N_LEAGUES * N_TEAMS * N_SLOTS:,}')

# ============================================================
# 6. Compute MWC
# ============================================================
print('\n' + '='*60)
print('6. COMPUTE MWC')
print('='*60)

league_ids = np.repeat(np.arange(N_LEAGUES), N_TEAMS * N_SLOTS)
team_ids = np.tile(np.repeat(np.arange(N_TEAMS), N_SLOTS), N_LEAGUES)
slot_ids = np.tile(np.arange(N_SLOTS), N_LEAGUES * N_TEAMS)
player_indices = all_rosters.reshape(-1)
finish_pcts = all_finish_pct[:, :, np.newaxis].repeat(N_SLOTS, axis=2).reshape(-1)

print(f'Total appearances: {len(player_indices):,}')

appearances_df = pd.DataFrame({
    'player_idx': player_indices,
    'finish_pct': finish_pcts,
    'league_id': league_ids,
    'team_id': team_ids,
})

player_agg = appearances_df.groupby('player_idx').agg(
    mean_finish=('finish_pct', 'mean'),
    n_appearances=('finish_pct', 'count'),
).reset_index()

player_agg['raw_mwc'] = player_agg['mean_finish'] - 0.5

print(f'Players with >= 30 appearances: {(player_agg.n_appearances >= 30).sum()}')
print(f'Players with <  30 appearances: {(player_agg.n_appearances < 30).sum()}')
print(f'\nAppearance distribution:')
print(player_agg['n_appearances'].describe())

# Controlled MWC
team_z_totals = np.zeros((N_LEAGUES, N_TEAMS))
for slot_idx in range(N_SLOTS):
    team_z_totals += z_pos[all_rosters[:, :, slot_idx]]

player_z_flat = z_pos[player_indices]
team_z_flat = team_z_totals[:, :, np.newaxis].repeat(N_SLOTS, axis=2).reshape(-1)
teammate_z = (team_z_flat - player_z_flat) / (N_SLOTS - 1)

appearances_df['teammate_z'] = teammate_z
appearances_df['player_z'] = player_z_flat

lr = LinearRegression()
lr.fit(teammate_z.reshape(-1, 1), finish_pcts)
print(f'\nTeammate Z coefficient: {lr.coef_[0]:.4f}')
print(f'Intercept: {lr.intercept_:.4f}')
print(f'R-squared: {lr.score(teammate_z.reshape(-1, 1), finish_pcts):.4f}')

appearances_df['residual'] = finish_pcts - lr.predict(teammate_z.reshape(-1, 1))

controlled_agg = appearances_df.groupby('player_idx').agg(
    controlled_mwc=('residual', 'mean'),
).reset_index()

player_agg = player_agg.merge(controlled_agg, on='player_idx')

# Merge back to main df
df_idx = df.reset_index(drop=True)
df_idx['player_idx'] = df_idx.index
results = df_idx.merge(player_agg, on='player_idx', how='left')

MIN_APPEARANCES = 30
results_filtered = results[results['n_appearances'] >= MIN_APPEARANCES].copy()
print(f'\nPlayers with >= {MIN_APPEARANCES} appearances: {len(results_filtered)}')
print(f'Mean raw MWC: {results_filtered.raw_mwc.mean():.6f} (should be ~0)')
print(f'Mean controlled MWC: {results_filtered.controlled_mwc.mean():.6f} (should be ~0)')

# ============================================================
# 7. Correlation Analysis
# ============================================================
print('\n' + '='*60)
print('7. CORRELATION ANALYSIS')
print('='*60)

rf = results_filtered

print('\n=== Overall Correlations ===')
predictors = [
    ('sandlot_score', 'Sandlot Score (clamped 1-10)'),
    ('z_score_position', 'z_score_position (unclamped)'),
]
for pred_col, pred_name in predictors:
    for target_col, target_name in [('raw_mwc', 'Raw MWC'), ('controlled_mwc', 'Controlled MWC')]:
        pearson_r, pearson_p = pearsonr(rf[pred_col].astype(float), rf[target_col])
        spearman_r, spearman_p = spearmanr(rf[pred_col].astype(float), rf[target_col])
        r_sq = pearson_r ** 2
        print(f'\n  {pred_name} vs {target_name}:')
        print(f'    Pearson r  = {pearson_r:.4f} (R² = {r_sq:.4f})')
        print(f'    Spearman ρ = {spearman_r:.4f}')

print('\n=== Per-Position Correlations (vs Controlled MWC) ===')
print(f'  {"Pos":>4s} {"n":>5s} | {"SS r":>8s} {"SS ρ":>8s} | {"z_pos r":>8s} {"z_pos ρ":>8s}')
print(f'  {"-"*4:>4s} {"-"*5:>5s} | {"-"*8:>8s} {"-"*8:>8s} | {"-"*8:>8s} {"-"*8:>8s}')
for pos in ['C', '1B', '2B', 'SS', '3B', 'OF', 'UTIL', 'SP', 'RP', 'P']:
    pos_data = rf[rf['primary_position'] == pos]
    if len(pos_data) < 10:
        continue
    ss_r, _ = pearsonr(pos_data['sandlot_score'], pos_data['controlled_mwc'])
    ss_rho, _ = spearmanr(pos_data['sandlot_score'], pos_data['controlled_mwc'])
    zp_r, _ = pearsonr(pos_data['z_score_position'].astype(float), pos_data['controlled_mwc'])
    zp_rho, _ = spearmanr(pos_data['z_score_position'].astype(float), pos_data['controlled_mwc'])
    print(f'  {pos:>4s} {len(pos_data):>5d} | {ss_r:>8.4f} {ss_rho:>8.4f} | {zp_r:>8.4f} {zp_rho:>8.4f}')

print('\n=== By Player Type ===')
for pt in ['batter', 'pitcher']:
    pt_data = rf[rf['player_type'] == pt]
    ss_r, _ = pearsonr(pt_data['sandlot_score'], pt_data['controlled_mwc'])
    zp_r, _ = pearsonr(pt_data['z_score_position'].astype(float), pt_data['controlled_mwc'])
    print(f'  {pt:>8s} (n={len(pt_data):>5d}): SS r={ss_r:.4f}, z_pos r={zp_r:.4f}')

# ============================================================
# 8. Scatter Plots
# ============================================================
print('\n' + '='*60)
print('8. SCATTER PLOTS')
print('='*60)

fig, axes = plt.subplots(2, 2, figsize=(16, 14))

scatter_predictors = [
    ('sandlot_score', 'Sandlot Score (clamped)'),
    ('z_score_position', 'z_score_position (unclamped)'),
]
for row_idx, (pred_col, pred_name) in enumerate(scatter_predictors):
    for col_idx, (target, title) in enumerate([('raw_mwc', 'Raw MWC'), ('controlled_mwc', 'Controlled MWC')]):
        ax = axes[row_idx, col_idx]
        pred_vals = rf[pred_col].astype(float)
        for pt, color, marker in [('batter', '#2196F3', 'o'), ('pitcher', '#FF5722', 's')]:
            mask = rf['player_type'] == pt
            ax.scatter(pred_vals[mask], rf.loc[mask, target],
                       alpha=0.15, s=8, c=color, marker=marker, label=pt.title())

        z = np.polyfit(pred_vals, rf[target], 1)
        x_line = np.linspace(pred_vals.min(), pred_vals.max(), 100)
        ax.plot(x_line, np.polyval(z, x_line), 'k--', linewidth=2, alpha=0.7)

        r, _ = pearsonr(pred_vals, rf[target])
        ax.set_xlabel(pred_name)
        ax.set_ylabel(title)
        ax.set_title(f'{pred_name} vs {title} (r={r:.3f}, R²={r**2:.3f})')
        ax.legend()
        ax.axhline(y=0, color='gray', linestyle='-', alpha=0.3)

plt.tight_layout()
plt.savefig(SIM_RESULTS_DIR / 'scatter_overall.png', dpi=150, bbox_inches='tight')
print('Saved scatter_overall.png')

# Per-position scatter
positions = ['C', '1B', '2B', 'SS', '3B', 'OF', 'UTIL', 'SP', 'RP', 'P']
fig, axes = plt.subplots(2, 5, figsize=(24, 10))

for idx, pos in enumerate(positions):
    ax = axes[idx // 5, idx % 5]
    pos_data = rf[rf['primary_position'] == pos]
    if len(pos_data) == 0:
        ax.set_title(f'{pos} (no data)')
        continue

    color = '#2196F3' if pos in ['C', '1B', '2B', 'SS', '3B', 'OF', 'UTIL'] else '#FF5722'
    ax.scatter(pos_data['sandlot_score'], pos_data['controlled_mwc'],
               alpha=0.2, s=10, c=color)

    if len(pos_data) >= 10:
        z = np.polyfit(pos_data['sandlot_score'], pos_data['controlled_mwc'], 1)
        x_line = np.linspace(pos_data['sandlot_score'].min(), pos_data['sandlot_score'].max(), 100)
        ax.plot(x_line, np.polyval(z, x_line), 'k--', linewidth=1.5, alpha=0.7)
        r, _ = pearsonr(pos_data['sandlot_score'], pos_data['controlled_mwc'])
        ax.set_title(f'{pos} (n={len(pos_data)}, r={r:.3f})')
    else:
        ax.set_title(f'{pos} (n={len(pos_data)})')

    ax.axhline(y=0, color='gray', linestyle='-', alpha=0.3)
    ax.set_xlabel('Sandlot Score')
    ax.set_ylabel('Controlled MWC')

plt.suptitle('Sandlot Score vs Controlled MWC by Position', fontsize=16, y=1.02)
plt.tight_layout()
plt.savefig(SIM_RESULTS_DIR / 'scatter_by_position.png', dpi=150, bbox_inches='tight')
print('Saved scatter_by_position.png')

# ============================================================
# 9. Outlier Identification
# ============================================================
print('\n' + '='*60)
print('9. OUTLIER IDENTIFICATION')
print('='*60)

lr_ss = LinearRegression()
lr_ss.fit(rf[['sandlot_score']], rf['controlled_mwc'])
rf = rf.copy()
rf['predicted_mwc'] = lr_ss.predict(rf[['sandlot_score']])
rf['mwc_residual'] = rf['controlled_mwc'] - rf['predicted_mwc']

display_cols = ['name', 'year', 'primary_position', 'sandlot_score',
                'controlled_mwc', 'mwc_residual', 'n_appearances',
                'R', 'HR', 'RBI', 'SB', 'AVG', 'W', 'SV', 'K', 'ERA', 'WHIP']

print('\n=== TOP 20 OVERPERFORMERS ===')
print('(Sandlot Score UNDERRATES these players)\n')
overperformers = rf.nlargest(20, 'mwc_residual')[display_cols]
print(overperformers.to_string(index=False, float_format='%.3f'))

print('\n\n=== TOP 20 UNDERPERFORMERS ===')
print('(Sandlot Score OVERRATES these players)\n')
underperformers = rf.nsmallest(20, 'mwc_residual')[display_cols]
print(underperformers.to_string(index=False, float_format='%.3f'))

# Residual plot
fig, ax = plt.subplots(figsize=(14, 8))
residual_std = rf['mwc_residual'].std()
outlier_mask = rf['mwc_residual'].abs() > 2 * residual_std

ax.scatter(rf.loc[~outlier_mask, 'sandlot_score'], rf.loc[~outlier_mask, 'mwc_residual'],
           alpha=0.1, s=8, c='#666', label='Normal')
ax.scatter(rf.loc[outlier_mask, 'sandlot_score'], rf.loc[outlier_mask, 'mwc_residual'],
           alpha=0.6, s=20, c='red', label=f'Outlier (>2σ, n={outlier_mask.sum()})')

for _, row in rf.nlargest(5, 'mwc_residual').iterrows():
    ax.annotate(f"{row['name']} '{str(row['year'])[-2:]}",
                (row['sandlot_score'], row['mwc_residual']),
                fontsize=8, alpha=0.8, ha='left')
for _, row in rf.nsmallest(5, 'mwc_residual').iterrows():
    ax.annotate(f"{row['name']} '{str(row['year'])[-2:]}",
                (row['sandlot_score'], row['mwc_residual']),
                fontsize=8, alpha=0.8, ha='left')

ax.axhline(y=0, color='black', linestyle='-', alpha=0.3)
ax.axhline(y=2*residual_std, color='red', linestyle='--', alpha=0.3)
ax.axhline(y=-2*residual_std, color='red', linestyle='--', alpha=0.3)
ax.set_xlabel('Sandlot Score')
ax.set_ylabel('MWC Residual')
ax.set_title('Sandlot Score Prediction Residuals')
ax.legend()
plt.tight_layout()
plt.savefig(SIM_RESULTS_DIR / 'residual_plot.png', dpi=150, bbox_inches='tight')
print('Saved residual_plot.png')

# ============================================================
# 10. Position Z-Score Inflation Analysis
# ============================================================
print('\n' + '='*60)
print('10. Z-SCORE INFLATION ANALYSIS')
print('='*60)

rf = rf.copy()
rf['z_inflation'] = rf['z_score_position'] - rf['z_score_overall']

r_inflation, p_inflation = pearsonr(rf['z_inflation'], rf['mwc_residual'])
print(f'Correlation between z-score inflation and MWC residual:')
print(f'  Pearson r = {r_inflation:.4f} (p = {p_inflation:.2e})')
print(f'  (Negative r means inflation predicts underperformance)')

print(f'\n=== Z-Score Inflation by Position ===')
inflation_by_pos = rf.groupby('primary_position').agg(
    mean_inflation=('z_inflation', 'mean'),
    std_inflation=('z_inflation', 'std'),
    n=('z_inflation', 'count'),
).sort_values('mean_inflation', ascending=False)
print(inflation_by_pos.to_string(float_format='%.4f'))

# Inflated underperformers
inflated_underperformers = rf[(rf['z_inflation'] > 2) & (rf['mwc_residual'] < -0.01)]
print(f'\nPlayers with z_inflation > 2 AND underperformance: {len(inflated_underperformers)}')

if len(inflated_underperformers) > 0:
    show_cols = ['name', 'year', 'primary_position', 'sandlot_score',
                 'z_score_position', 'z_score_overall', 'z_inflation',
                 'controlled_mwc', 'mwc_residual',
                 'R', 'HR', 'RBI', 'SB', 'AVG', 'W', 'SV', 'K', 'ERA', 'WHIP']
    print('\nTop 15 inflated underperformers:')
    print(inflated_underperformers.nsmallest(15, 'mwc_residual')[show_cols].to_string(index=False, float_format='%.3f'))

# Inflation scatter
fig, ax = plt.subplots(figsize=(12, 8))
colors_map = {'C': '#E91E63', '1B': '#9C27B0', '2B': '#673AB7', 'SS': '#3F51B5',
              '3B': '#2196F3', 'OF': '#009688', 'UTIL': '#795548',
              'SP': '#FF9800', 'RP': '#FF5722', 'P': '#607D8B'}

for pos in positions:
    mask = rf['primary_position'] == pos
    ax.scatter(rf.loc[mask, 'z_inflation'], rf.loc[mask, 'mwc_residual'],
               alpha=0.15, s=10, c=colors_map.get(pos, 'gray'), label=pos)

z = np.polyfit(rf['z_inflation'], rf['mwc_residual'], 1)
x_line = np.linspace(rf['z_inflation'].min(), rf['z_inflation'].max(), 100)
ax.plot(x_line, np.polyval(z, x_line), 'k--', linewidth=2)

ax.axhline(y=0, color='gray', linestyle='-', alpha=0.3)
ax.axvline(x=0, color='gray', linestyle='-', alpha=0.3)
ax.set_xlabel('Z-Score Inflation (position z - overall z)')
ax.set_ylabel('MWC Residual')
ax.set_title(f'Position Z-Score Inflation vs MWC Residual (r={r_inflation:.3f})')
ax.legend(loc='upper right', ncol=2, fontsize=8)
plt.tight_layout()
plt.savefig(SIM_RESULTS_DIR / 'inflation_vs_residual.png', dpi=150, bbox_inches='tight')
print('Saved inflation_vs_residual.png')

# ============================================================
# 11. Model: Optimal Weights & Blend (CORRECTED FEATURES)
# ============================================================
# Uses the ACTUAL scoring components (recomputed in Section 2.5),
# not the display z-scores from category_zscores.
print('\n' + '='*60)
print('11. MODEL COMPARISON (Correct Features)')
print('='*60)

bat_rf = rf[rf['player_type'] == 'batter'].copy()
pit_rf = rf[rf['player_type'] == 'pitcher'].copy()

def evaluate_model(X, y, model_name, alpha=1.0):
    model = Ridge(alpha=alpha)
    scores = cross_val_score(model, X, y, cv=5, scoring='r2')
    model.fit(X, y)
    r2_full = model.score(X, y)
    spearman_r_val = spearmanr(model.predict(X), y)[0]
    print(f'  {model_name:>45s}: CV R²={scores.mean():.4f} (±{scores.std():.4f}), '
          f'Full R²={r2_full:.4f}, Spearman={spearman_r_val:.4f}')
    return model, scores.mean()

# ---- BATTER MODELS ----
# Actual scoring components: [R, HR, RBI, SB, H, Outs] with weights [+1,+1,+1,+1,+1,-1]
print('\n=== BATTER MODELS ===')
target_bat = bat_rf['controlled_mwc'].values

# Baselines
X_base_ss = bat_rf[['sandlot_score']].values
m_base_ss_bat, _ = evaluate_model(X_base_ss, target_bat, 'Baseline (Sandlot Score, clamped)')
X_base_zp = bat_rf[['z_score_position']].values.astype(float)
m_base_zp_bat, _ = evaluate_model(X_base_zp, target_bat, 'Baseline (z_score_position, unclamped)')

# Model A: Positional z-scores (actual formula features)
bat_a_cols = ['sc_pz_R', 'sc_pz_HR', 'sc_pz_RBI', 'sc_pz_SB', 'sc_pz_H', 'sc_pz_Outs']
X_a_bat = bat_rf[bat_a_cols].values.astype(float)
m_a_bat, _ = evaluate_model(X_a_bat, target_bat, 'Model A (Positional Z, actual components)')

# Model B: Overall z-scores
bat_b_cols = ['sc_oz_R', 'sc_oz_HR', 'sc_oz_RBI', 'sc_oz_SB', 'sc_oz_H', 'sc_oz_Outs']
X_b_bat = bat_rf[bat_b_cols].values.astype(float)
m_b_bat, _ = evaluate_model(X_b_bat, target_bat, 'Model B (Overall Z)')

# Model C: Blended (positional + overall for each component)
bat_c_cols = bat_a_cols + bat_b_cols
X_c_bat = bat_rf[bat_c_cols].values.astype(float)
m_c_bat, _ = evaluate_model(X_c_bat, target_bat, 'Model C (Blended Z)')

# Model D: Kitchen sink
raw_bat_cols = ['R', 'HR', 'RBI', 'SB', 'H', 'AB', 'AVG']
pos_dummies_bat = pd.get_dummies(bat_rf['primary_position'], prefix='pos')
X_d_bat = np.column_stack([
    bat_rf[raw_bat_cols].values.astype(float),
    X_c_bat,
    pos_dummies_bat.values
])
m_d_bat, _ = evaluate_model(X_d_bat, target_bat, 'Model D (Kitchen Sink)')

# ---- PITCHER MODELS ----
# Actual scoring components: [W, SV, SO, ER_saved, BR_saved] weights [+1,+1,+1,+1,+1]
# W_Z and SV_Z use OVERALL z-scores in the actual formula
print('\n=== PITCHER MODELS ===')
target_pit = pit_rf['controlled_mwc'].values

X_base_ss = pit_rf[['sandlot_score']].values
m_base_ss_pit, _ = evaluate_model(X_base_ss, target_pit, 'Baseline (Sandlot Score, clamped)')
X_base_zp = pit_rf[['z_score_position']].values.astype(float)
m_base_zp_pit, _ = evaluate_model(X_base_zp, target_pit, 'Baseline (z_score_position, unclamped)')

# Model A-current: Actual formula (W/SV overall, SO/ER_saved/BR_saved positional)
pit_a0_cols = ['sc_oz_W', 'sc_oz_SV', 'sc_pz_SO', 'sc_pz_ER_saved', 'sc_pz_BR_saved']
X_a0_pit = pit_rf[pit_a0_cols].values.astype(float)
m_a0_pit, _ = evaluate_model(X_a0_pit, target_pit, 'Model A-current (W/SV overall, rest pos)')

# Model A: All positional z-scores (what it WOULD be if W/SV were positional too)
pit_a_cols = ['sc_pz_W', 'sc_pz_SV', 'sc_pz_SO', 'sc_pz_ER_saved', 'sc_pz_BR_saved']
X_a_pit = pit_rf[pit_a_cols].values.astype(float)
m_a_pit, _ = evaluate_model(X_a_pit, target_pit, 'Model A (All Positional Z)')

# Model B: All overall z-scores
pit_b_cols = ['sc_oz_W', 'sc_oz_SV', 'sc_oz_SO', 'sc_oz_ER_saved', 'sc_oz_BR_saved']
X_b_pit = pit_rf[pit_b_cols].values.astype(float)
m_b_pit, _ = evaluate_model(X_b_pit, target_pit, 'Model B (Overall Z)')

# Model C: Blend all 5 components (positional + overall for each)
pit_c_cols = pit_a_cols + pit_b_cols
X_c_pit = pit_rf[pit_c_cols].values.astype(float)
m_c_pit, _ = evaluate_model(X_c_pit, target_pit, 'Model C (Blended Z, all 5)')

# Model D: Kitchen sink
raw_pit_cols = ['W', 'SV', 'K', 'ERA', 'WHIP', 'IP']
pos_dummies_pit = pd.get_dummies(pit_rf['primary_position'], prefix='pos')
X_d_pit = np.column_stack([
    pit_rf[raw_pit_cols].values.astype(float),
    X_c_pit,
    pos_dummies_pit.values
])
m_d_pit, _ = evaluate_model(X_d_pit, target_pit, 'Model D (Kitchen Sink)')

# ---- WEIGHT COMPARISON CHART ----
fig, axes = plt.subplots(1, 2, figsize=(16, 6))

bat_labels = ['R', 'HR', 'RBI', 'SB', 'H', 'Outs']
sandlot_weights_bat = np.array([1, 1, 1, 1, 1, -1], dtype=float)
learned_weights_bat = m_a_bat.coef_
# Normalize Sandlot weights to same total magnitude as learned
sandlot_norm_bat = sandlot_weights_bat / np.abs(sandlot_weights_bat).sum() * np.abs(learned_weights_bat).sum()

ax = axes[0]
x = np.arange(len(bat_labels))
width = 0.35
ax.bar(x - width/2, sandlot_norm_bat, width, label='Current Sandlot', color='#2196F3', alpha=0.7)
ax.bar(x + width/2, learned_weights_bat, width, label='Optimal (Ridge)', color='#FF5722', alpha=0.7)
ax.set_xticks(x)
ax.set_xticklabels(bat_labels)
ax.set_ylabel('Weight')
ax.set_title('Batter Category Weights: Current vs Optimal')
ax.legend()
ax.axhline(y=0, color='gray', linestyle='-', alpha=0.3)

pit_labels = ['W', 'SV', 'SO', 'ER_saved', 'BR_saved']
sandlot_weights_pit = np.array([1, 1, 1, 1, 1], dtype=float)
learned_weights_pit = m_a_pit.coef_
sandlot_norm_pit = sandlot_weights_pit / np.abs(sandlot_weights_pit).sum() * np.abs(learned_weights_pit).sum()

ax = axes[1]
x = np.arange(len(pit_labels))
ax.bar(x - width/2, sandlot_norm_pit, width, label='Current Sandlot', color='#2196F3', alpha=0.7)
ax.bar(x + width/2, learned_weights_pit, width, label='Optimal (Ridge)', color='#FF5722', alpha=0.7)
ax.set_xticks(x)
ax.set_xticklabels(pit_labels, rotation=15)
ax.set_ylabel('Weight')
ax.set_title('Pitcher Category Weights: Current vs Optimal')
ax.legend()
ax.axhline(y=0, color='gray', linestyle='-', alpha=0.3)

plt.tight_layout()
plt.savefig(SIM_RESULTS_DIR / 'weight_comparison.png', dpi=150, bbox_inches='tight')
print('Saved weight_comparison.png')

print('\nBatter Model A coefficients (actual scoring components):')
for label, coef in zip(bat_labels, learned_weights_bat):
    print(f'  {label:>10s}: {coef:.6f}')

print('\nPitcher Model A coefficients (actual scoring components):')
for label, coef in zip(pit_labels, learned_weights_pit):
    print(f'  {label:>10s}: {coef:.6f}')

# ---- BLEND RATIOS (Model C) ----
print('\n=== MODEL C: POSITIONAL vs OVERALL BLEND RATIOS ===')

print('\nBatter blend ratios (all 6 components):')
bat_blend_labels = bat_labels  # R, HR, RBI, SB, H, Outs
n_bat = len(bat_blend_labels)
for i, label in enumerate(bat_blend_labels):
    pos_coef = m_c_bat.coef_[i]
    ovr_coef = m_c_bat.coef_[i + n_bat]
    pos_w = abs(pos_coef)
    ovr_w = abs(ovr_coef)
    total = pos_w + ovr_w
    if total > 0:
        print(f'  {label:>10s}: pos={pos_coef:+.4f} ({pos_w/total*100:.0f}%), ovr={ovr_coef:+.4f} ({ovr_w/total*100:.0f}%)')

# Pitchers: blend all 5 components
print('\nPitcher blend ratios (all 5 components):')
pit_blend_labels = ['W', 'SV', 'SO', 'ER_saved', 'BR_saved']
n_pit = len(pit_blend_labels)
# Model C features: [W_pz, SV_pz, SO_pz, ER_saved_pz, BR_saved_pz, W_oz, SV_oz, SO_oz, ER_saved_oz, BR_saved_oz]
for i, label in enumerate(pit_blend_labels):
    pos_coef = m_c_pit.coef_[i]
    ovr_coef = m_c_pit.coef_[i + n_pit]
    pos_w = abs(pos_coef)
    ovr_w = abs(ovr_coef)
    total = pos_w + ovr_w
    if total > 0:
        print(f'  {label:>10s}: pos={pos_coef:+.4f} ({pos_w/total*100:.0f}%), ovr={ovr_coef:+.4f} ({ovr_w/total*100:.0f}%)')

# ============================================================
# 12. Persist Results
# ============================================================
print('\n' + '='*60)
print('12. PERSIST RESULTS')
print('='*60)

# player_mwc.parquet — include recomputed scoring components
mwc_cols = ['id', 'player_id', 'name', 'year', 'team', 'player_type', 'primary_position',
            'sandlot_score', 'z_score_position', 'z_score_overall',
            'raw_mwc', 'controlled_mwc', 'n_appearances',
            'R', 'HR', 'RBI', 'SB', 'H', 'AB', 'AVG',
            'W', 'SV', 'K', 'ERA', 'WHIP', 'IP']
# Add all recomputed scoring component columns
sc_cols = sorted([c for c in results.columns if c.startswith('sc_')])
mwc_cols = mwc_cols + sc_cols
available_cols = [c for c in mwc_cols if c in results.columns]
results[available_cols].to_parquet(SIM_RESULTS_DIR / 'player_mwc.parquet', index=False)
print(f'  player_mwc.parquet: {len(results):,} rows')

# team_stats.parquet
team_records = []
stat_names = ['R', 'HR', 'RBI', 'SB', 'AVG', 'W', 'SV', 'K', 'ERA', 'WHIP', 'roto_points', 'finish_rank']
for league_idx in range(N_LEAGUES):
    for team_idx in range(N_TEAMS):
        record = {'league_id': league_idx, 'team_id': team_idx}
        for si, sn in enumerate(stat_names):
            record[sn] = float(all_team_stats[league_idx, team_idx, si])
        record['finish_pct'] = float(all_finish_pct[league_idx, team_idx])
        team_records.append(record)

team_stats_df = pd.DataFrame(team_records)
team_stats_df.to_parquet(SIM_RESULTS_DIR / 'team_stats.parquet', index=False)
print(f'  team_stats.parquet: {len(team_stats_df):,} rows')

print('\nAll results saved to sim-results/')

# ============================================================
# 13. Fun League Analyses
# ============================================================
print('\n' + '='*60)
print('13. FUN LEAGUE ANALYSES')
print('='*60)

# Greatest team ever
best_league, best_team = np.unravel_index(all_team_stats[:, :, 10].argmax(), (N_LEAGUES, N_TEAMS))
best_roto = all_team_stats[best_league, best_team, 10]
print(f'\n=== GREATEST TEAM EVER ===')
print(f'League #{best_league}, Team #{best_team} — {best_roto:.1f} roto points\n')

best_roster = all_rosters[best_league, best_team]
for slot_idx, slot in enumerate(ROSTER_SLOTS):
    pidx = best_roster[slot_idx]
    row = df_idx.iloc[pidx]
    print(f'  {slot:>4s}: {row["name"]:>25s} ({row["year"]}) — Sandlot {row["sandlot_score"]:.1f}')

print(f'\nTeam stats: R={all_team_stats[best_league, best_team, 0]:.0f}, '
      f'HR={all_team_stats[best_league, best_team, 1]:.0f}, '
      f'RBI={all_team_stats[best_league, best_team, 2]:.0f}, '
      f'SB={all_team_stats[best_league, best_team, 3]:.0f}, '
      f'AVG={all_team_stats[best_league, best_team, 4]:.3f}, '
      f'W={all_team_stats[best_league, best_team, 5]:.0f}, '
      f'SV={all_team_stats[best_league, best_team, 6]:.0f}, '
      f'K={all_team_stats[best_league, best_team, 7]:.0f}, '
      f'ERA={all_team_stats[best_league, best_team, 8]:.2f}, '
      f'WHIP={all_team_stats[best_league, best_team, 9]:.3f}')

# Worst team ever
worst_league, worst_team = np.unravel_index(all_team_stats[:, :, 10].argmin(), (N_LEAGUES, N_TEAMS))
worst_roto = all_team_stats[worst_league, worst_team, 10]
print(f'\n=== WORST TEAM EVER ===')
print(f'League #{worst_league}, Team #{worst_team} — {worst_roto:.1f} roto points\n')

worst_roster = all_rosters[worst_league, worst_team]
for slot_idx, slot in enumerate(ROSTER_SLOTS):
    pidx = worst_roster[slot_idx]
    row = df_idx.iloc[pidx]
    print(f'  {slot:>4s}: {row["name"]:>25s} ({row["year"]}) — Sandlot {row["sandlot_score"]:.1f}')

# Most dominant league win
roto_points_all = all_team_stats[:, :, 10]
sorted_roto = np.sort(roto_points_all, axis=1)
gap_1st_2nd = sorted_roto[:, -1] - sorted_roto[:, -2]
most_dominant = gap_1st_2nd.argmax()
print(f'\n=== MOST DOMINANT LEAGUE WIN ===')
print(f'League #{most_dominant}: gap of {gap_1st_2nd[most_dominant]:.1f} roto points between 1st and 2nd')
print(f'Winner: {sorted_roto[most_dominant, -1]:.1f} pts, Runner-up: {sorted_roto[most_dominant, -2]:.1f} pts')

# Best sleeper team
print(f'\n=== BEST SLEEPER TEAM ===')
print('(League winner with lowest average Sandlot Score)')

best_sleeper_score = float('inf')
best_sleeper = None

for league_idx in range(N_LEAGUES):
    winner_team = all_finish_pct[league_idx].argmax()
    if all_finish_pct[league_idx, winner_team] < 0.99:
        continue
    roster = all_rosters[league_idx, winner_team]
    avg_ss = df_idx.iloc[roster]['sandlot_score'].mean()
    if avg_ss < best_sleeper_score:
        best_sleeper_score = avg_ss
        best_sleeper = (league_idx, winner_team)

if best_sleeper:
    sl, st = best_sleeper
    print(f'League #{sl}, Team #{st} — Avg Sandlot Score: {best_sleeper_score:.2f}')
    print(f'Roto points: {all_team_stats[sl, st, 10]:.1f}')
    roster = all_rosters[sl, st]
    for slot_idx, slot in enumerate(ROSTER_SLOTS):
        pidx = roster[slot_idx]
        row = df_idx.iloc[pidx]
        print(f'  {slot:>4s}: {row["name"]:>25s} ({row["year"]}) — Sandlot {row["sandlot_score"]:.1f}')

# Dream Lineup
print(f'\n=== DREAM LINEUP ===')
print('(Highest Controlled MWC at each roster position)\n')

dream_slots = ['C', '1B', '2B', 'SS', '3B', 'OF', 'UTIL', 'SP', 'RP', 'P']
used_players = set()

for slot in dream_slots:
    if slot == 'UTIL':
        eligible = rf[rf['player_type'] == 'batter']
    elif slot == 'P':
        eligible = rf[rf['player_type'] == 'pitcher']
    elif slot == 'OF':
        eligible = rf[rf['pos_set'].apply(lambda s: bool(s & {'LF', 'CF', 'RF', 'OF'}))]
    elif slot in ('SP', 'RP'):
        eligible = rf[rf['pos_set'].apply(lambda s: slot in s)]
    else:
        eligible = rf[rf['pos_set'].apply(lambda s: slot in s)]

    eligible = eligible[~eligible['id'].isin(used_players)]
    best = eligible.nlargest(1, 'controlled_mwc').iloc[0]
    used_players.add(best['id'])

    print(f'  {slot:>4s}: {best["name"]:>25s} ({best["year"]}) — '
          f'Sandlot {best["sandlot_score"]:.1f}, MWC {best["controlled_mwc"]:.4f}')

# ============================================================
# 14. Convergence Check
# ============================================================
print('\n' + '='*60)
print('14. CONVERGENCE CHECK')
print('='*60)

sample_players = rf.nlargest(5, 'n_appearances')[['player_idx', 'name', 'year']]

fractions = [0.1, 0.25, 0.5, 0.75, 1.0]
convergence_data = []

for frac in fractions:
    n = int(N_LEAGUES * frac)
    sub_rosters = all_rosters[:n]
    sub_finish = all_finish_pct[:n]

    flat_r = sub_rosters.reshape(-1)
    flat_f = sub_finish[:, :, np.newaxis].repeat(N_SLOTS, axis=2).reshape(-1)

    sub_df = pd.DataFrame({'player_idx': flat_r, 'finish_pct': flat_f})
    sub_agg = sub_df.groupby('player_idx')['finish_pct'].mean() - 0.5

    for _, row in sample_players.iterrows():
        pidx = row['player_idx']
        if pidx in sub_agg.index:
            convergence_data.append({
                'fraction': frac,
                'n_leagues': n,
                'name': f"{row['name']} ({row['year']})",
                'mwc': sub_agg[pidx]
            })

conv_df = pd.DataFrame(convergence_data)

fig, ax = plt.subplots(figsize=(10, 6))
for name in conv_df['name'].unique():
    data = conv_df[conv_df['name'] == name]
    ax.plot(data['n_leagues'], data['mwc'], 'o-', label=name)

ax.set_xlabel('Number of Leagues')
ax.set_ylabel('Raw MWC')
ax.set_title('MWC Convergence Check')
ax.legend(fontsize=8)
ax.axhline(y=0, color='gray', linestyle='-', alpha=0.3)
plt.tight_layout()
plt.savefig(SIM_RESULTS_DIR / 'convergence.png', dpi=150, bbox_inches='tight')
print('Saved convergence.png')

# Appearance distribution
fig, ax = plt.subplots(figsize=(10, 6))
ax.hist(player_agg['n_appearances'], bins=50, color='#2196F3', alpha=0.7, edgecolor='white')
ax.axvline(x=MIN_APPEARANCES, color='red', linestyle='--', label=f'Min threshold ({MIN_APPEARANCES})')
ax.set_xlabel('Number of Appearances')
ax.set_ylabel('Player-Seasons')
ax.set_title('Distribution of Player Appearances')
ax.legend()
plt.tight_layout()
plt.savefig(SIM_RESULTS_DIR / 'appearances_dist.png', dpi=150, bbox_inches='tight')
print('Saved appearances_dist.png')

# ============================================================
# 15. Summary
# ============================================================
print('\n' + '='*70)
print('SANDLOT SCORE VALIDATION STUDY — KEY FINDINGS')
print('='*70)

r_ss, _ = pearsonr(rf['sandlot_score'], rf['controlled_mwc'])
r_zp, _ = pearsonr(rf['z_score_position'].astype(float), rf['controlled_mwc'])
rho_ss, _ = spearmanr(rf['sandlot_score'], rf['controlled_mwc'])
rho_zp, _ = spearmanr(rf['z_score_position'].astype(float), rf['controlled_mwc'])
print(f'\n1. OVERALL CORRELATION (vs Controlled MWC)')
print(f'   Sandlot Score (clamped):    r={r_ss:.4f}, R²={r_ss**2:.4f}, ρ={rho_ss:.4f}')
print(f'   z_score_position (unclamped): r={r_zp:.4f}, R²={r_zp**2:.4f}, ρ={rho_zp:.4f}')
print(f'   Clamping info loss: Δr = {r_zp - r_ss:.4f}')

print(f'\n2. POSITION Z-SCORE INFLATION')
print(f'   Inflation ↔ MWC residual correlation: r = {r_inflation:.4f}')
if r_inflation < -0.05:
    print(f'   CONFIRMED: Position-specific z-scoring systematically overrates players')
    print(f'   with inflated scores in rare position/category combos')
elif r_inflation > 0.05:
    print(f'   SURPRISE: Position inflation actually HELPS predict winning')
else:
    print(f'   NEUTRAL: Position inflation has minimal effect on prediction accuracy')

print(f'\n3. BIGGEST OUTLIERS')
top_over = rf.nlargest(3, 'mwc_residual')
print(f'   Most underrated by Sandlot Score:')
for _, row in top_over.iterrows():
    print(f'     {row["name"]} ({row["year"]}) {row["primary_position"]} — '
          f'Sandlot {row["sandlot_score"]:.1f}, MWC residual +{row["mwc_residual"]:.4f}')

top_under = rf.nsmallest(3, 'mwc_residual')
print(f'   Most overrated by Sandlot Score:')
for _, row in top_under.iterrows():
    print(f'     {row["name"]} ({row["year"]}) {row["primary_position"]} — '
          f'Sandlot {row["sandlot_score"]:.1f}, MWC residual {row["mwc_residual"]:.4f}')

print(f'\n4. RESULTS SAVED')
print(f'   Parquet files in: {SIM_RESULTS_DIR.absolute()}')
print(f'   Plots saved as PNG files in same directory')
print('\n' + '='*70)
