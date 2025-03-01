# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Retromatic is a fantasy baseball draft game where users draft historical MLB players (1961-2023) to create all-time dream teams. Teams are scored using rotisserie scoring across 10 statistical categories (5 batting, 5 pitching) with percentile-based rankings.

## Commands

```bash
# Development
npm start              # Start React dev server at http://localhost:3000
npm run build          # Production build
npm test               # Run tests via react-scripts

# Data preprocessing (requires Python with pandas, numpy, scipy)
python data-preprocessing/preprocess-to-sqlite.py \
  data-preprocessing/lahman_1871-2023_csv \
  ./data/retromatic.db
```

## Architecture

### Tech Stack
- **Frontend**: React 18 + TypeScript, Material-UI (MUI) 6, React Router 6, Framer Motion
- **Backend**: Supabase (PostgreSQL) or local SQLite for development
- **Data Processing**: Python scripts process Lahman Baseball Database CSVs

### Key Directories
- `src/pages/` - Main application pages (Home, Draft, Results)
- `src/services/` - Data layer abstraction (`supabase.ts` for production, `localData.ts` for local dev)
- `src/types/` - TypeScript definitions for Player, Draft, Pick, Roster types
- `src/theme/` - MUI theme with baseball-inspired colors
- `data-preprocessing/` - Python ETL scripts for player statistics
- `docs/` - Design documentation (Architecture.md, PRD.md, CoreFlows.md)

### Data Flow
1. Lahman CSV data → Python preprocessing → SQLite/Supabase
2. Service layer (`src/services/`) abstracts database backend
3. Draft page loads players, manages pick state, calculates scores
4. Results page displays team composition and percentile ranking

### Core Types (src/types/index.ts)
- `Player`: id, name, position, year, stats (batting or pitching), zScore, posZScore
- `Draft`: id, status ('created'|'in_progress'|'completed'), picks[], score, percentile
- `Pick`: player selection with round/pick number
- `BattingStats`: R, HR, RBI, SB, AVG
- `PitchingStats`: W, SV, K, ERA, WHIP

### Scoring System
- Z-scores are pre-computed during data preprocessing for fair cross-era player comparisons
- Both position-relative (posZScore) and overall (zScore) rankings available
- Team scores calculated by summing player z-scores across categories

### Routing
- `/` - Home page
- `/draft` - New solo draft
- `/draft/:draftId` - Resume existing draft
- `/results/:draftId` - View completed draft results

## Environment Configuration

Copy `.env.example` to `.env`. The app supports two modes:
- **Local**: Uses SQLite database at `./data/retromatic.db`
- **Production**: Set `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` for Supabase

## Important Notes

- README mentions Chakra UI but codebase actually uses Material-UI (MUI)
- Draft interface intentionally has no search/filter - this is a memory-based game design choice
- Multiplayer functionality is planned for future phases but not yet implemented
- The `contexts/`, `hooks/`, and `utils/` directories exist but are empty (reserved for future use)
