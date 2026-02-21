# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**Sandlot** is a mobile-first daily fantasy baseball draft challenge. Each day, all users play the same 10-round draft, picking from curated historical MLB player-seasons (1961-2025). Inspired by DraftKings Flash Draft and Immaculate Grid.

### Core Game Loop
1. All 10 rounds of data loaded upfront at game start (single API call)
2. Each round shows 3 players × 3 year options = 9 choices for one roster position
3. 30-second timer per pick (auto-random on timeout)
4. After picking: instant client-side reveal with Legend Score, AI blurb, community pick % (no server round-trip)
5. 10 rounds total (C, 1B, 2B, SS, 3B, OF, UTIL, SP, RP, P — order randomized daily)
6. Game state saved to localStorage after each pick (crash recovery)
7. Final results: all picks submitted in one batch, server re-validates scores

### Legend Score
Position-adjusted Z-score mapped to a 1.0-10.0 scale. This is the game's signature metric — measures how good a player-year was relative to others at that position.

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
- `frontend/src/components/game/` — PickGrid, Timer, LineupCard, RevealCard, LegendScoreBadge, PlayerPortrait
- `frontend/src/components/admin/` — AdminGuard, StatusBadge, HealthIndicators
- `frontend/src/components/ui/` — PaperCard, VintageButton (shared design system)
- `frontend/src/hooks/` — useGame (state machine), useTimer, useChallenge, useAdmin (admin mutations)
- `frontend/src/lib/` — api.ts (game API client), adminApi.ts (admin API client), legendScore.ts (client-side scoring), gameStorage.ts (localStorage), utils.ts (helpers)
- `backend/src/routes/` — challenge.ts, admin.ts
- `backend/src/services/` — legendScore.ts, challengeGenerator.ts, challengeBlurbs.ts, dailyScheduler.ts, portraitGenerator.ts, statsPreseeder.ts
- `backend/src/db/` — Drizzle schema and connection
- `data-preprocessing/` — Jupyter notebook, Python preprocessing scripts
- `data-pipeline/` — PostgreSQL data ingestion

### Database Tables
- `players` — ~36,500 player-season records with pre-computed Z-scores (read-only data, 1961-2025)
- `challenges` — daily challenge definitions with position order and theme
- `challenge_rounds` — 10 rounds per challenge, each with a position
- `round_options` — 3 players per round, each with 3 year options, portrait URL, AI blurbs
- `game_sessions` — user game state (current round, total score, completion)
- `user_picks` — individual pick records with Legend Score
- `pick_stats` — aggregated pick counts for "X% picked this"

### API Routes

**Game (public)**:
- `GET /api/challenge/today` — today's challenge + user's session status
- `POST /api/challenge/:id/start` — begin game, returns ALL round data upfront (enriched players, stats, community picks)
- `POST /api/challenge/:id/complete` — submit all 10 picks at once, get final results
- `GET /api/challenge/:id/results` — completed game results with community stats
- `GET /api/challenge/streak` — current user's play streak

**Admin (requires `x-admin-secret` header)**:
- `POST /api/admin/challenges/generate` — generate challenge(s), optional `{count, theme, date}`
- `POST /api/admin/challenges/generate-themed` — generate batch of themed challenges with auto-scheduling
- `POST /api/admin/challenges/schedule` — assign dates to challenges `{challengeIds, startDate}`
- `GET /api/admin/challenges/pipeline` — all challenges with health summaries (blurbs/portraits/rounds status)
- `GET /api/admin/challenges` — list all challenges
- `GET /api/admin/challenges/:id` — challenge detail with rounds, players, z-scores, Legend Scores
- `GET /api/admin/challenges/:id/health` — detailed health check (blurb/portrait/score counts)
- `PATCH /api/admin/challenges/:id` — update status, theme, date, position order
- `DELETE /api/admin/challenges/:id` — delete a challenge
- `POST /api/admin/challenges/:id/blurbs` — generate AI blurbs via OpenAI (parallelized, ~45s)
- `POST /api/admin/challenges/:id/portraits` — generate AI portraits via Gemini
- `POST /api/admin/challenges/:id/preseed` — pre-seed community pick stats (200 synthetic picks)
- `POST /api/admin/challenges/:id/playtest` — start playtest session (no real session, any challenge status)
- `DELETE /api/admin/challenges/:id/reset` — reset a user's session (requires `x-guest-token` header)
- `POST /api/admin/activate-today` — activate today's scheduled challenge, complete yesterday's

### Frontend Game State Machine
```
LOADING → PICKING (30s timer, client-side) → REVEALING (5s) → next round or SUBMITTING_FINAL → COMPLETE
```
Picks are computed client-side (Legend Score from z-scores). Game state saved to localStorage after each pick. Single batch submission at game end.

### Routing
- `/` — Home (daily challenge launcher)
- `/play` — Game (10-round draft); supports `?playtest=<challengeId>` for admin playtest mode
- `/results/:challengeId` — Results page
- `/admin/login` — Admin login (enter `ADMIN_SECRET`)
- `/admin` — Admin "Front Office" dashboard (pipeline overview, calendar strip, generation controls)
- `/admin/challenge/:id` — Challenge detail (health, rounds, players, blurbs, playtest button)

### Admin UI ("Front Office")
The admin dashboard at `/admin` provides:
- **Calendar strip**: 14-day view with green/amber/empty dots showing challenge coverage
- **Pipeline view**: challenges grouped by Active / Upcoming / Draft with health indicators
- **Generation**: single challenge, 25-themed batch, or activate today's challenge
- **Challenge detail page**: per-round breakdown of players, Legend Scores, blurb previews, portrait thumbnails
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

Copy `backend/.env.example` to `backend/.env`:
- `DATABASE_URL` — PostgreSQL connection string
- `OPENAI_API_KEY` — for AI-generated player blurbs (optional, falls back to templates)
- `ADMIN_SECRET` — protects admin API routes (used in admin UI login and `x-admin-secret` header)
- `PORT` — backend port (default 3001)

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

## Deployment (Railway)

Hosted on Railway with Nixpacks. Key files:
- `railway.toml` — build/deploy configuration
- `backend/src/scripts/migrate.ts` — idempotent SQL migrations (compiled to `dist/scripts/migrate.js`)

### Deploy pipeline
1. **Build**: Nixpacks runs `npm run build` (installs deps, builds frontend + backend)
2. **Pre-deploy**: `preDeployCommand` runs the compiled migration script (`node backend/dist/scripts/migrate.js`). Runs in a separate ephemeral container with access to env vars (including `DATABASE_URL`). If it fails, the deploy is aborted and the old version keeps running.
3. **Start**: `npm start` launches the Express server
4. **Healthcheck**: Railway pings `/api/health` (60s timeout)

### Migration rules
- Migrations run via `preDeployCommand` in `railway.toml`, not in the start command
- All migrations must be **idempotent** (use `IF NOT EXISTS`, `IF EXISTS`, `DO $$ ... END $$` blocks)
- Migration script uses raw `postgres` (production dependency), not `drizzle-kit` (devDependency, unavailable at runtime)
- On failure, `process.exitCode = 1` aborts the deploy cleanly

### Important: devDependencies are pruned at runtime
Nixpacks prunes devDependencies after the build phase. Never use devDependency tools (`tsx`, `drizzle-kit`, `vitest`, etc.) in `startCommand` or `preDeployCommand`. Use compiled JS (`node dist/...`) instead.

## Working Principles

- **Check docs before inventing solutions.** When facing infrastructure, deployment, or tooling problems, research the platform's documentation first (Railway docs, Nixpacks/Railpack docs, library docs). These platforms have solved common problems — use their built-in primitives (`preDeployCommand`, healthchecks, etc.) rather than building custom workarounds.
- **One change at a time for infrastructure.** Don't switch the builder, migration strategy, and deploy config all at once. Make incremental changes so failures are easy to diagnose.

## Design Principles

- **Mobile-first**: All UI optimized for phone screens (375px viewport). Touch targets 44px+.
- **Fun over depth**: Quick 5-minute daily game, not a complex fantasy simulator
- **Legend Score is the star**: The branded 1-10 metric should feel satisfying and shareable
- **Daily challenge = social glue**: Same slate for everyone enables comparison and conversation
