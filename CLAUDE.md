# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**Sandlot** is a mobile-first daily fantasy baseball draft challenge. Each day, all users play the same 10-round draft, picking from curated historical MLB player-seasons (1961-2023). Inspired by DraftKings Flash Draft and Immaculate Grid.

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
cd data-pipeline && python preprocess-to-postgres.py ../data-preprocessing/lahman_1871-2023_csv
```

## Architecture

### Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS 4, TanStack React Query, Framer Motion, Lucide icons
- **Backend**: Express 5, TypeScript, Drizzle ORM, PostgreSQL, OpenAI API (for blurbs)
- **Data Pipeline**: Python (pandas, numpy, scipy) processes Lahman Baseball Database

### Key Directories
- `frontend/src/pages/` — Home, Game, Results, Leaderboard
- `frontend/src/components/game/` — PickGrid, Timer, RosterStrip, RevealCard, LegendScoreBadge, PlayerPortrait
- `frontend/src/hooks/` — useGame (state machine), useTimer, useChallenge
- `frontend/src/lib/` — api.ts (API client), legendScore.ts (client-side scoring), gameStorage.ts (localStorage), utils.ts (helpers)
- `backend/src/routes/` — challenge.ts, leaderboard.ts, admin.ts
- `backend/src/services/` — legendScore.ts, challengeGenerator.ts, challengeBlurbs.ts, dailyScheduler.ts
- `backend/src/db/` — Drizzle schema and connection
- `data-preprocessing/` — Jupyter notebook, Python preprocessing scripts
- `data-pipeline/` — PostgreSQL data ingestion

### Database Tables
- `players` — 34,815 player-season records with pre-computed Z-scores (read-only data)
- `challenges` — daily challenge definitions with position order and theme
- `challenge_rounds` — 10 rounds per challenge, each with a position
- `round_options` — 3 players per round, each with 3 year options, portrait URL, AI blurbs
- `game_sessions` — user game state (current round, total score, completion)
- `user_picks` — individual pick records with Legend Score
- `pick_stats` — aggregated pick counts for "X% picked this"

### API Routes
- `GET /api/challenge/today` — today's challenge + user's session status
- `POST /api/challenge/:id/start` — begin game, returns ALL round data upfront (enriched players, stats, community picks)
- `POST /api/challenge/:id/complete` — submit all 10 picks at once, get final results
- `GET /api/challenge/:id/results` — completed game results with community stats
- `GET /api/leaderboard` — daily/weekly/all-time rankings
- `POST /api/admin/challenges/generate` — generate challenges (admin)

### Frontend Game State Machine
```
LOADING → PICKING (30s timer, client-side) → REVEALING (5s) → next round or SUBMITTING_FINAL → COMPLETE
```
Picks are computed client-side (Legend Score from z-scores). Game state saved to localStorage after each pick. Single batch submission at game end.

### Routing
- `/` — Home (daily challenge launcher)
- `/play` — Game (10-round draft)
- `/results/:challengeId` — Results page
- `/leaderboard` — Leaderboard

## Environment Configuration

Copy `backend/.env.example` to `backend/.env`:
- `DATABASE_URL` — PostgreSQL connection string
- `OPENAI_API_KEY` — for AI-generated player blurbs (optional, falls back to templates)
- `ADMIN_SECRET` — protects admin API routes
- `PORT` — backend port (default 3001)

## Design Principles

- **Mobile-first**: All UI optimized for phone screens (375px viewport). Touch targets 44px+.
- **Fun over depth**: Quick 5-minute daily game, not a complex fantasy simulator
- **Legend Score is the star**: The branded 1-10 metric should feel satisfying and shareable
- **Daily challenge = social glue**: Same slate for everyone enables comparison and conversation
