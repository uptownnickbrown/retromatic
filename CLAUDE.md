# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**Sandlot** is a mobile-first daily fantasy baseball draft challenge. Each day, all users play the same 10-round draft, picking from curated historical MLB player-seasons (1961-2025). Inspired by DraftKings Flash Draft and Immaculate Grid.

### Core Game Loop
1. All 10 rounds of data loaded upfront at game start (single API call)
2. Each round shows 3 players × 3 year options = 9 choices for one roster position
3. 30-second timer per pick (auto-random on timeout)
4. After picking: instant client-side reveal with Sandlot Score, AI blurb, community pick % (no server round-trip)
5. 10 rounds total (C, 1B, 2B, SS, 3B, OF, UTIL, SP, RP, P — order randomized daily)
6. Game state saved to localStorage after each pick (crash recovery)
7. Final results: all picks submitted in one batch, server re-validates scores

### Sandlot Score
The game's signature 1.0–10.0 metric. Measures how dominant a player-season was relative to others at the same position.

**How it's computed** (data pipeline, `preprocess-to-postgres.py`):
1. **Individual stat z-scores** — each counting stat is z-scored both within its position group (positional z) and across all players (overall z).
   - Batters: R, HR, RBI, SB, H, Outs (where `Outs = AB - H`, encoding AVG in volume-weighted form)
   - Pitchers: W, SV (overall z only), SO, ER_saved, BR_saved (where `ER_saved = IP × (mean_ERA − ERA) / 9`)
2. **Composite z-score (v2)** — Ridge-learned weights combine **blended z-scores** (positional + overall) into `z_score_position`. Trained on 10K simulated roto leagues to predict Marginal Win Contribution (MWC). See `data-preprocessing/SANDLOT_SCORE_CALIBRATION.md` for the full methodology.
   - **Batters**: 19-feature model (12 blended z-scores + 7 position intercepts), rescaled × `BATTER_SCALE = 1.10`
   - **Pitchers**: separate SP and RP models (16 features each: 10 blended z-scores + 6 raw stats), `PITCHER_SCALE = 1.00`
   - The blend lets the model learn how much each stat should be position-relative vs league-wide (e.g., SB leans ~75% overall to fix catcher SB inflation)
3. **Linear mapping** — `z_score_position` is mapped to 1.0–10.0 (clamped at z=−2 and z=10):
   `sandlotScore = 1.0 + ((clamp(z, -2, 10) + 2) / 12) × 9.0`

Scores ≥ 9.5 (z ≥ 9.33) earn "Sandlot Legend" status. The 10.0 cap costs only Δr=0.005 in predictive accuracy — a good UX tradeoff.

**Special cases**: UTIL batters and P-position pitchers have tiny pools, so they use overall z-scores (not position-relative) and fall back to equal-weight sums (no Ridge model).

## Commands

```bash
# Start PostgreSQL
docker compose up -d

# Backend (Terminal 1)
cd backend && npm run dev    # Express server at http://localhost:3001

# Frontend (Terminal 2)
cd frontend && npm run dev   # Vite dev server at http://localhost:3000

# Database migration
cd backend && npx drizzle-kit push

# Data pipeline (one-time, populates player data)
cd data-pipeline && python preprocess-to-postgres.py ../data-preprocessing/lahman_1871-2025_csv

# CI verification (run before pushing — matches GitHub Actions exactly)
cd frontend && npm run lint && npx tsc -b --noEmit && npm test
cd backend && npm run lint && npx tsc --noEmit && npm test
```

**Important:** The frontend CI uses `tsc -b --noEmit` (build mode), which is stricter than `tsc --noEmit`. Always use `-b` locally to catch errors before pushing.

## Architecture

### Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS 4, TanStack React Query, Framer Motion, Lucide icons
- **Backend**: Express 5, TypeScript, Drizzle ORM, PostgreSQL, OpenAI API (for blurbs)
- **Data Pipeline**: Python (pandas, numpy, scipy) processes Lahman Baseball Database

### Key Directories
- `frontend/src/pages/` — Home, Game, Results, AdminLogin, AdminDashboard, AdminChallengeDetail
- `frontend/src/components/game/` — PickGrid, Timer, LineupCard, RevealCard, SandlotScoreBadge, PlayerPortrait
- `frontend/src/components/admin/` — AdminGuard, StatusBadge, HealthIndicators
- `frontend/src/components/ui/` — PaperCard, VintageButton (shared design system)
- `frontend/src/hooks/` — useGame (state machine), useTimer, useChallenge, useAdmin (admin mutations)
- `frontend/src/lib/` — api.ts (game API client), adminApi.ts (admin API client), sandlotScore.ts (client-side scoring), gameStorage.ts (localStorage), utils.ts (helpers)
- `backend/src/routes/` — challenge.ts, admin.ts
- `backend/src/services/` — sandlotScore.ts, challengeGenerator.ts, challengeBlurbs.ts, dailyScheduler.ts, portraitGenerator.ts, statsPreseeder.ts
- `backend/src/db/` — Drizzle schema and connection
- `data-preprocessing/` — Jupyter notebook, Python preprocessing scripts
- `data-pipeline/` — PostgreSQL data ingestion

### Database Tables
- `players` — ~36,500 player-season records with pre-computed Z-scores (read-only data, 1961-2025)
- `challenges` — daily challenge definitions with position order and theme
- `challenge_rounds` — 10 rounds per challenge, each with a position
- `round_options` — 3 players per round, each with 3 year options, portrait URL, AI blurbs
- `game_sessions` — user game state (current round, total score, completion)
- `user_picks` — individual pick records with Sandlot Score
- `pick_stats` — aggregated pick counts for "X% picked this"

### API Routes

**Game (public)**:
- `GET /api/challenge/today` — today's challenge + user's session status
- `POST /api/challenge/:id/start` — begin game, returns ALL round data upfront (enriched players, stats, community picks)
- `POST /api/challenge/:id/complete` — submit all 10 picks at once, get final results
- `GET /api/challenge/:id/results` — completed game results with community stats
- `GET /api/challenge/streak` — current user's play streak

**Admin**: Protected by auth + rate limiting. See `backend/src/routes/admin.ts` for endpoints.

### Frontend Game State Machine
```
LOADING → PICKING (30s timer, client-side) → REVEALING (5s) → next round or SUBMITTING_FINAL → COMPLETE
```
Picks are computed client-side (Sandlot Score from z-scores). Game state saved to localStorage after each pick. Single batch submission at game end.

### Routing
- `/` — Home (daily challenge launcher)
- `/play` — Game (10-round draft); supports `?playtest=<challengeId>` for admin playtest mode
- `/results/:challengeId` — Results page
- `/admin/login` — Admin login
- `/admin` — Admin "Front Office" dashboard (pipeline overview, calendar strip, generation controls)
- `/admin/challenge/:id` — Challenge detail (health, rounds, players, blurbs, playtest button)

### Admin UI ("Front Office")
The admin dashboard at `/admin` provides:
- **Calendar strip**: 14-day view with green/amber/empty dots showing challenge coverage
- **Pipeline view**: challenges grouped by Active / Upcoming / Draft with health indicators
- **Generation**: single challenge, 25-themed batch, or activate today's challenge
- **Challenge detail page**: per-round breakdown of players, Sandlot Scores, blurb previews, portrait thumbnails
- **Action buttons**: Generate Blurbs, Generate Portraits, Preseed Stats, Schedule, Playtest, Delete
- **Playtest mode**: plays any challenge in-browser with a yellow "Playtest Mode" banner, no real session created, returns to admin detail on completion

### Challenge Data Pipeline
A fully baked challenge requires these steps (can be done from admin UI or API):
1. **Generate** — creates challenge with 10 rounds, 3 players each, 3 year options per player
2. **Generate Blurbs** — AI-written player-season blurbs via OpenAI (~45s for 90 blurbs, parallelized 8-way)
3. **Generate Portraits** — AI stipple-engraving portraits via Gemini
4. **Preseed Stats** — 200 synthetic community picks for realistic "X% picked this" on day one
5. **Schedule** — assign a date and set status to "scheduled"
6. **Activate** — daily scheduler sets today's challenge to "active" (automatic or manual via admin)

## Environment Configuration

Copy `backend/.env.example` to `backend/.env`. See that file for required variables.

### Network / Mobile Testing
- Vite dev server listens on all interfaces (`host: true` in vite.config.ts)
- Access from other devices on the same Wi-Fi via `http://<laptop-ip>:3000`
- The Vite proxy forwards `/api` requests to the backend at `localhost:3001`

### Fonts
Only two font families are defined in the theme (`index.css`):
- `font-editorial` — Playfair Display (headings, player names, scores)
- `font-mono` — Space Mono (stats, labels, body text, blurbs)

Do not use `font-hand`, `font-sans`, or other undefined font classes.

### Data Model: Players Table
Each row in `players` is a **player-season** (e.g., "Mike Trout 2019" and "Mike Trout 2020" are separate rows with different IDs). This means `playerRecordId` is unique per player-year, not per player name. When matching across year options for the same player, use the set of all `playerRecordId` values, not a single ID.

## Deployment

Hosted on Railway. See `.claude/PRIVATE_NOTES.md` for deploy pipeline details (not tracked in git).

## Working Principles

- **Check docs before inventing solutions.** When facing infrastructure, deployment, or tooling problems, research the platform's documentation first. Use built-in primitives rather than building custom workarounds.
- **One change at a time for infrastructure.** Don't switch the builder, migration strategy, and deploy config all at once. Make incremental changes so failures are easy to diagnose.

## Design Principles

- **Mobile-first**: All UI optimized for phone screens (375px viewport). Touch targets 44px+.
- **Fun over depth**: Quick 5-minute daily game, not a complex fantasy simulator
- **Sandlot Score is the star**: The branded 1-10 metric should feel satisfying and shareable
- **Daily challenge = social glue**: Same slate for everyone enables comparison and conversation
