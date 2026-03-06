# Sandlot Score Calibration Study

## Research Question

Does the Sandlot Score — a sum of positional z-scores mapped linearly to 1.0–10.0 — actually predict a player-season's contribution to winning in fantasy baseball? Where does it under- or overvalue players, and can we do better?

## How the Sandlot Score Works Today

### Batting Composite (6 components, equal weight)
```
Total_POS_Z = R_POS_Z + HR_POS_Z + RBI_POS_Z + SB_POS_Z + H_POS_Z - Outs_POS_Z
```
- Each stat is z-scored within its position group (e.g., HR for catchers only)
- `Outs = AB - H` — this is how AVG is encoded: H_Z - Outs_Z captures batting average in a volume-weighted counting-stat form. More AB at the same AVG = more credit, which is correct for roto where team AVG = sum(H)/sum(AB)
- AVG_Z is computed separately for display percentile bars but intentionally excluded from the composite to avoid double-counting with H and Outs
- UTIL batters use overall z-scores (pool too small for position-relative)

### Pitching Composite (5 components, equal weight)
```
Total_POS_Z = W_Z + SV_Z + SO_POS_Z + ER_saved_POS_Z + BR_saved_POS_Z
```
- W_Z and SV_Z use **overall** z-scores (not position-relative) because SPs rarely save and RPs rarely win — position-specific z-scores for these cross-position stats have near-zero variance, creating extreme outliers
- SO, ER_saved, BR_saved use position-relative z-scores

**Rate stat encoding (key design choice):**
```python
ER_saved = IP * (pos_mean_ERA - player_ERA) / 9   # earned runs saved vs position average
BR_saved = IP * (pos_mean_WHIP - player_WHIP)     # baserunners saved vs position average
```
This converts rate stats into counting stats that naturally weight by innings:
- A starter with 200 IP at 2.00 ERA saves ~44 runs vs average → high ER_saved
- A reliever with 70 IP at 2.00 ERA saves ~16 runs → proportionally less
- Position-relative z-scoring then compares the SP's ER_saved against other SPs, and the RP's against other RPs, partially normalizing for volume differences

P-position pitchers use overall z-scores (pool too small).

### Mapping to 1.0–10.0
```
sandlot_score = 1.0 + ((clamp(z, -2, 10) + 2) / 12) * 9.0
```

### Source Files
- Scoring pipeline: `data-pipeline/preprocess-to-postgres.py`
- Client formula: `frontend/src/lib/sandlotScore.ts`
- Server formula: `backend/src/services/sandlotScore.ts`

---

## Experimental Design

### Approach: Roto League Simulation
Simulate 10,000 twelve-team fantasy leagues with snake drafts. Measure each player-season's empirical **Marginal Win Contribution (MWC)** — how much does having this player on your team improve your finish? Compare MWC to Sandlot Score.

### Roster (16 slots per team)
```
C, 1B, 2B, SS, 3B, OF, OF, OF, UTIL, SP, SP, RP, RP, P, P, P
```
- UTIL = any batter
- P = any pitcher (SP or RP)

### 5x5 Roto Categories
- **Batting**: R, HR, RBI, SB, AVG (where team AVG = sum(H)/sum(AB))
- **Pitching**: W, SV, K, ERA, WHIP (where team ERA = sum(ER)*9/sum(IP), team WHIP = (sum(P_H)+sum(P_BB))/sum(IP))

Deliberately standard 5x5 roto — NOT the Sandlot Score's own categories. Using the same categories would be circular. Standard roto is the external benchmark.

### Draft Mechanics
- Snake draft, 16 rounds, scarce positions first (C, SS, 2B, 3B, 1B, OF×3, UTIL, SP×2, RP×2, P×3)
- Pick probability weighted by `max(z_score_position, 0.01) ^ 1.5` — smarter than random, dumber than optimal
- Each league drafts from the full pool of ~35,000 player-seasons

### Target Variable: Marginal Win Contribution (MWC)
- **Raw MWC** = mean(team_finish_percentile) - 0.5 across all league appearances
- **Controlled MWC** = residual after regressing out teammate quality (isolates individual contribution)
- Finish percentile: 0.0 = last place, 1.0 = first place (based on roto point ranking)
- Minimum 30 appearances for inclusion

### Implementation
- Script: `data-preprocessing/run_validation.py`
- Notebook: `data-preprocessing/sandlot-score-validation.ipynb`
- Output: `data-preprocessing/sim-results/` (parquet files + PNG plots)
- Python venv: `data-preprocessing/.venv/`

---

## Results So Far

### 1. Overall Correlation: Strong (r=0.863)

| Metric | Pearson r | R² | Spearman ρ |
|---|---|---|---|
| Sandlot Score vs Raw MWC | 0.782 | 0.612 | 0.741 |
| Sandlot Score vs Controlled MWC | 0.863 | 0.744 | 0.829 |

The Sandlot Score explains 74% of variance in actual win contribution. The controlled MWC (which isolates individual contribution from teammate noise) correlates better, as expected.

### 2. Per-Position Correlation

| Position | n | Pearson r | Spearman ρ |
|---|---|---|---|
| SS | 659 | 0.920 | 0.873 |
| OF | 2,008 | 0.920 | 0.890 |
| 2B | 719 | 0.889 | 0.836 |
| SP | 2,759 | 0.885 | 0.836 |
| 3B | 677 | 0.874 | 0.858 |
| 1B | 706 | 0.849 | 0.823 |
| C | 568 | 0.831 | 0.781 |
| RP | 2,545 | 0.806 | 0.760 |
| UTIL | 24 | 0.802 | 0.781 |

The score works best for SS and OF (r=0.92) and worst for RP (r=0.81) and C (r=0.83). These are also the positions most affected by inflation (see below).

### 3. Position Z-Score Inflation: Confirmed (r=-0.180)

**Hypothesis**: Position-specific z-scoring can produce outlandish values for uncommon stat/position combos (e.g., SB at C, SV at SP). A catcher with 20 SB gets SB_z = +4 because catchers average 2 SB, but in roto 20 SB is merely league-average.

**Finding**: Confirmed. Pearson r = -0.180 between z-score inflation (`z_score_position - z_score_overall`) and MWC residual, with p = 4.89e-78. Higher inflation → systematic underperformance.

**Inflation by position** (mean z_inflation):
| Position | Mean Inflation | Interpretation |
|---|---|---|
| C | +2.84 | Catchers are most inflated — stats like SB, HR get disproportionate z-scores |
| RP | +1.54 | Relievers get inflated SO, ER_saved z-scores |
| SS | +1.23 | Shortstops get inflated power/speed z-scores |
| 2B | +1.20 | Similar to SS |
| 3B | +0.34 | Modest inflation |
| UTIL | 0.00 | Uses overall z-scores (no inflation by design) |
| 1B | -0.57 | First basemen are *deflated* — their position pool has high stat baselines |
| OF | -0.89 | Outfielders also deflated |
| SP | -1.30 | Starters are most deflated — deep pool with high volume stats |

566 player-seasons have z_inflation > 2 AND underperform their Sandlot Score.

### 4. Poster-Child Outliers

**Most overrated by Sandlot Score** (score too high for actual win contribution):
| Player | Year | Pos | Sandlot | z_pos | z_overall | Inflation | Key Issue |
|---|---|---|---|---|---|---|---|
| Alan Wiggins | 1983 | 1B | 8.9 | 8.59 | 3.48 | +5.12 | 66 SB, 0 HR — huge positional SB z-score but no power |
| Don Baylor | 1976 | 1B | 8.8 | 8.43 | 4.81 | +3.63 | 52 SB at 1B — same inflation pattern |
| John Wathan | 1982 | C | 10.0 | 10.70 | 2.04 | +8.67 | 36 SB at catcher = absurd z-score, but 3 HR, 51 RBI |
| Craig Biggio | 1990 | C | 6.7 | 5.57 | -0.40 | +5.96 | 25 SB, 4 HR at catcher — inflated by position |

Pattern: speed-first players at non-speed positions get outlandish SB z-scores that inflate their composite.

**Most underrated by Sandlot Score** (score too low for actual win contribution):
| Player | Year | Pos | Sandlot | Residual | Key Stats |
|---|---|---|---|---|---|
| Sandy Koufax | 1965 | SP | 10.0 | +0.179 | 26 W, 382 K, 2.04 ERA — already capped at 10.0 but actual value even higher |
| Bob Gibson | 1968 | SP | 10.0 | +0.169 | 22 W, 268 K, 1.12 ERA |
| Denny McLain | 1968 | SP | 10.0 | +0.166 | 31 W, 280 K, 1.96 ERA |

Pattern: Elite SP seasons are capped at 10.0 by the scoring formula but their actual roto contribution is far above other 10.0 seasons. The clamping at z=10 compresses the top end.

### 5. Fun Findings

**Greatest team ever drafted** (116.5 roto points out of 120 max):
Russell Martin '07 (C), A-Rod '98 (SS), Bret Boone '01 (2B), Carlos Delgado '03 (1B), Frank Robinson '61 (OF), Ryan Braun '12 (OF), David Ortiz '05 (UTIL), Denny McLain '68 (SP), Bob Gibson '68 (P), Joe Nathan '04 (RP)
Team stats: .310 AVG, 292 HR, 1.90 ERA

**Dream lineup** (highest MWC at each position):
C: Mike Piazza '97, 1B: Todd Helton '00, 2B: Joe Morgan '76, SS: A-Rod '96, 3B: A-Rod '07, OF: Ronald Acuña '23, UTIL: Shohei Ohtani '24, SP: Sandy Koufax '65, RP: Dick Radatz '64, P: Bob Gibson '68

**Best sleeper team** (league winner with lowest avg Sandlot Score = 6.33):
Won despite mediocre roster — Ken Caminiti '96 and Denny McLain '68 carried

---

## Issues Uncovered

### Issue 1: Feature Mismatch in Model Comparison — RESOLVED

The original model comparison used DB `category_zscores` (display z-scores for percentile bars) instead of the actual scoring components. This has been fixed — the script now recomputes the exact scoring components from raw stats (Outs_POS_Z for batters, ER_saved_POS_Z/BR_saved_POS_Z for pitchers) matching `preprocess-to-postgres.py`. Validation: r=0.998 between recomputed and DB z-scores for both batters and pitchers.

### Issue 2: Rate Stat Encoding is Actually Good (confirmed)

- **H_Z - Outs_Z** encodes AVG in a volume-weighted form appropriate for roto. A .333 hitter in 600 AB gets more credit than .333 in 300 AB — correct because team AVG = sum(H)/sum(AB).
- **ER_saved / BR_saved** properly weight by IP, converting rate quality into counting-stat value.

### Issue 3: Top-End Compression — Minimal Impact (Δr = 0.005)

Clamping at z=10 barely affects predictive accuracy:
- Sandlot Score (clamped 1-10): r=0.863 vs Controlled MWC
- z_score_position (unclamped): r=0.868 vs Controlled MWC
- **Δr = 0.005** — the 10.0 cap is a good UX choice that costs almost nothing statistically

The Spearman ρ is identical (0.829) because rank-order is preserved for >99% of players.

---

## Model Comparison Results (Corrected Features)

### Batter Models (predicting Controlled MWC, 5-fold CV)

| Model | Features | CV R² |
|---|---|---|
| Baseline (clamped) | sandlot_score | 0.786 |
| Baseline (unclamped) | z_score_position | 0.787 |
| **A (Actual Components)** | R, HR, RBI, SB, H, Outs (positional z) | **0.857** |
| B (Overall Z) | Same stats, overall z | 0.701 |
| **C (Blended)** | Positional + overall z per category | **0.873** |
| D (Kitchen Sink) | Blended + raw stats + position dummies | 0.889 |

### Pitcher Models

| Model | Features | CV R² |
|---|---|---|
| Baseline (clamped) | sandlot_score | 0.696 |
| Baseline (unclamped) | z_score_position | 0.713 |
| A (Actual Formula) | W, SV (overall), SO, ER_saved, BR_saved (positional) | 0.751 |
| **B (Overall Z)** | All overall z-scores | **0.764** |
| **C (Blended)** | Positional + overall z for SO/ER_saved/BR_saved | **0.794** |
| D (Kitchen Sink) | Blended + raw stats + IP + position dummies | 0.869 |

### Learned Category Weights (Model A, Ridge Regression)

**Batters** — current Sandlot weights are [+1, +1, +1, +1, +1, -1]:

| Category | Learned Weight | Interpretation |
|---|---|---|
| R | 0.033 | Slightly overweighted vs current |
| HR | 0.017 | Currently overweighted |
| RBI | 0.021 | About right |
| SB | 0.012 | **Currently overweighted** — should carry less than R, HR, RBI |
| H | 0.037 | Strongest single predictor |
| Outs | -0.034 | Strong negative weight (correct sign) |

**Pitchers** — current Sandlot weights are [+1, +1, +1, +1, +1]:

| Category | Learned Weight | Interpretation |
|---|---|---|
| W | 0.017 | Moderate |
| SV | 0.017 | Moderate |
| SO | 0.012 | Lower priority |
| ER_saved | 0.025 | **Strongest predictor** |
| BR_saved | 0.029 | **Strongest predictor** — rate quality matters most |

### Blend Ratios (Model C — the actionable finding)

**Batters** — for each stat, what % should be position-relative vs overall?

| Category | Positional % | Overall % | Implication |
|---|---|---|---|
| R | 63% | 37% | Mostly keep positional |
| HR | 50% | 50% | Split evenly |
| RBI | 44% | 56% | Slight shift to overall |
| **SB** | **25%** | **75%** | **Heavy shift to overall — fixes catcher SB inflation** |
| H | 0% | 100% | Model wants pure overall |
| Outs | 86% | 14% | Keep positional |

**Pitchers** (SO, ER_saved, BR_saved — W and SV are already overall):

| Category | Positional % | Overall % | Implication |
|---|---|---|---|
| SO | 97% | 3% | Keep positional |
| **ER_saved** | **22%** | **78%** | **Heavy shift to overall** |
| **BR_saved** | **23%** | **77%** | **Heavy shift to overall** |

---

## Interpretation & Recommendations

### What the Data Says

1. **The Sandlot Score is fundamentally sound.** r=0.863 against actual roto win contribution is strong. The equal-weight, position-z approach captures most of what matters.

2. **Position inflation is real but targeted.** The -0.183 inflation correlation means players who benefit most from position-specific z-scoring (catchers, relievers) tend to underperform their scores. The fix isn't to abandon positional z-scoring — it's to blend in overall z-scores for specific categories.

3. **SB is the clearest fix.** 25% positional / 75% overall would eliminate the catcher-SB inflation problem (John Wathan, Craig Biggio) without removing positional context entirely.

4. **Pitcher rate stats should lean overall.** ER_saved and BR_saved at ~22% positional / ~78% overall would reduce RP inflation while keeping some position context.

5. **Clamping is fine.** Δr = 0.005 means the 10.0 cap costs almost nothing. The game benefits (legendary seasons feel special, draft variety) far outweigh the statistical cost.

### What We'd Change

If implementing blended z-scores, the formula would become:
```
category_z = α * POS_Z + (1-α) * OVERALL_Z
```

With suggested α values:
| Category | α (positional share) |
|---|---|
| R | 0.60 |
| HR | 0.50 |
| RBI | 0.45 |
| SB | **0.25** |
| H | 0.00 (pure overall) |
| Outs | 0.85 |
| W | 0.00 (already overall) |
| SV | 0.00 (already overall) |
| SO | 1.00 (pure positional) |
| ER_saved | **0.25** |
| BR_saved | **0.25** |

### Open Questions

- Should we validate with modern era only (2000-2025)?
- What would the impact be on specific edge-case players users care about?

---

## Implementation Status

The blended z-score approach (Model C + position dummies from Model D) was implemented as **Sandlot Score v2** in commit `bdd75f9`. Key implementation details:

- **Batters**: 19-feature Ridge model (12 blended z-scores + 7 position intercepts), rescaled to match original z-score distribution, then × `BATTER_SCALE = 1.10`
- **Pitchers**: Separate SP and RP Ridge models (16 features each: 10 blended z-scores + 6 raw stats), rescaled, `PITCHER_SCALE = 1.00`. P-position fallback to equal-weight sums.
- Weights extracted via `extract_weights.py`, calibration experiments in `experiment_calibration.py` and `experiment_pitcher_enrich.py`
- Production scoring pipeline: `data-pipeline/preprocess-to-postgres.py`
- The client/server `sandlotScore.ts` files are unchanged — they just map the pre-computed `z_score_position` to 1.0–10.0

---

## File Inventory

| File | Description |
|---|---|
| `pull_player_data.py` | Pulls player data from Railway prod DB, caches as parquet |
| `sim-data/players.parquet` | Cached player data (35,399 rows, gitignored) |
| `run_validation.py` | Main simulation script (runs in ~17 min) |
| `sandlot-score-validation.ipynb` | Jupyter notebook version (same code, may be stale) |
| `sim-results/player_mwc.parquet` | Per-player MWC results with scoring components (35,399 rows) |
| `sim-results/team_stats.parquet` | Per-team category totals and rankings (120,000 rows) |
| `sim-results/scatter_overall.png` | 2×2 grid: clamped + unclamped vs Raw + Controlled MWC |
| `sim-results/scatter_by_position.png` | Per-position scatter grid (2×5) |
| `sim-results/residual_plot.png` | MWC residuals with labeled outliers |
| `sim-results/inflation_vs_residual.png` | Z-score inflation vs MWC residual by position |
| `sim-results/weight_comparison.png` | Category weights: current vs optimal (corrected features) |
| `sim-results/convergence.png` | MWC stability across league subsamples |
| `sim-results/appearances_dist.png` | Player appearance frequency distribution |
