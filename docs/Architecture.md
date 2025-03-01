# Retromatic System Architecture

This document describes the system architecture for Retromatic, including the technology stack, backend components, data storage design, and API structure.

## Tech Stack Overview

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18 + TypeScript, Vite, shadcn/ui + Tailwind CSS, Framer Motion, React Query |
| **Backend** | Node.js + Express + TypeScript, Drizzle ORM, Zod validation |
| **Database** | PostgreSQL 15 |
| **Data Pipeline** | Python 3.11+ with pandas, numpy, scipy |
| **AI Commentary** | OpenAI API |
| **Deployment** | Frontend: Vercel, Backend: Railway/Fly.io, Database: Railway PostgreSQL or Neon |

### Technology Choices

**Frontend:**
- **Vite** for fast development builds (replacing create-react-app)
- **shadcn/ui + Tailwind CSS** for a modern, customizable component library with vintage baseball styling
- **Framer Motion** for dramatic results reveal animations
- **React Query** for server state management and caching

**Backend:**
- **Express** for a simple, well-understood REST API framework
- **Drizzle ORM** for type-safe database queries with minimal overhead
- **Zod** for request validation

**Database:**
- **PostgreSQL** directly (no BaaS abstraction layer) for full control and standard tooling
- Managed PostgreSQL via Railway or Neon for production

## Directory Structure

```
retromatic/
├── frontend/                    # React application
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/             # shadcn/ui components
│   │   │   ├── draft/          # Draft-specific components
│   │   │   ├── results/        # Results reveal components
│   │   │   └── layout/         # Header, Footer, Navigation
│   │   ├── pages/
│   │   │   ├── Home.tsx
│   │   │   ├── Draft.tsx
│   │   │   ├── Results.tsx
│   │   │   ├── Leaderboard.tsx
│   │   │   └── History.tsx
│   │   ├── hooks/
│   │   │   ├── useDraft.ts
│   │   │   ├── usePlayerSearch.ts
│   │   │   └── useLeaderboard.ts
│   │   ├── lib/
│   │   │   ├── api.ts          # API client
│   │   │   └── utils.ts
│   │   └── types/
│   │       └── index.ts
│   ├── tailwind.config.ts
│   └── vite.config.ts
│
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── players.ts
│   │   │   ├── drafts.ts
│   │   │   ├── leaderboard.ts
│   │   │   └── share.ts
│   │   ├── db/
│   │   │   ├── schema.ts       # Drizzle schema
│   │   │   ├── migrations/
│   │   │   └── index.ts
│   │   ├── services/
│   │   │   ├── scoring.ts      # Roto league, win-loss, percentiles
│   │   │   ├── draft.ts        # Draft game logic
│   │   │   ├── outliers.ts     # Fun fact detection
│   │   │   └── commentary.ts   # OpenAI integration
│   │   └── index.ts
│   └── package.json
│
├── data-pipeline/               # Python scripts
│   ├── preprocess_batting.py
│   ├── preprocess_pitching.py
│   ├── compute_zscores.py
│   ├── generate_team_pool.py   # Monte Carlo team generation
│   └── load_to_postgres.py
│
└── docker-compose.yml          # Local PostgreSQL
```

## Database Schema

```sql
-- Players (read-only after data pipeline)
CREATE TABLE players (
    id SERIAL PRIMARY KEY,
    player_id VARCHAR(20) NOT NULL,      -- Lahman playerID
    name_first VARCHAR(100),
    name_last VARCHAR(100),
    year INTEGER NOT NULL,
    team VARCHAR(10),
    player_type VARCHAR(10) NOT NULL,    -- 'batter' or 'pitcher'
    primary_position VARCHAR(10) NOT NULL,
    positions_eligible VARCHAR(50) NOT NULL,
    stats JSONB NOT NULL,
    z_score_overall DECIMAL(8,4) NOT NULL,
    z_score_position DECIMAL(8,4) NOT NULL,
    category_zscores JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_player_year UNIQUE (player_id, year)
);

CREATE INDEX idx_players_name ON players(name_last, name_first);
CREATE INDEX idx_players_year ON players(year);
CREATE INDEX idx_players_position ON players(primary_position);
CREATE INDEX idx_players_zscore ON players(z_score_position DESC);

-- Users (for future auth)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255),
    display_name VARCHAR(100),
    auth_provider VARCHAR(50),
    guest_token VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Drafts
CREATE TABLE drafts (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    guest_token VARCHAR(255),            -- For guest users
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    total_score DECIMAL(10,4),
    percentile INTEGER,
    category_scores JSONB,
    ai_commentary TEXT,
    roto_placement INTEGER,              -- 1-12 placement in simulated league
    win_loss_record VARCHAR(50),         -- e.g., "8432-1568"
    outlier_facts JSONB,                 -- Array of fun facts
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX idx_drafts_user ON drafts(user_id);
CREATE INDEX idx_drafts_guest ON drafts(guest_token);
CREATE INDEX idx_drafts_percentile ON drafts(percentile DESC) WHERE status = 'completed';

-- Picks
CREATE TABLE picks (
    id SERIAL PRIMARY KEY,
    draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id),
    roster_slot VARCHAR(10) NOT NULL,
    pick_order INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_draft_slot UNIQUE (draft_id, roster_slot),
    CONSTRAINT unique_draft_player UNIQUE (draft_id, player_id)
);

-- Team pool (pre-generated + real user teams for comparisons)
CREATE TABLE team_pool (
    id SERIAL PRIMARY KEY,
    draft_id INTEGER REFERENCES drafts(id),  -- NULL for simulated teams
    is_simulated BOOLEAN DEFAULT false,
    category_totals JSONB NOT NULL,          -- {R: 1247, HR: 312, ...}
    total_score DECIMAL(10,4) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_team_pool_score ON team_pool(total_score DESC);
CREATE INDEX idx_team_pool_category ON team_pool USING GIN (category_totals);
```

## API Endpoints

### Players

```
GET /api/players/search?q={name}&year={year}&position={pos}
```
Returns player identifying information only (NO stats, NO z-scores during draft):
```json
{
  "players": [
    {
      "id": 123,
      "name": "Babe Ruth",
      "years": "1914-1935",
      "teams": ["BOS", "NYY"],
      "positions": ["OF", "P"]
    }
  ]
}
```

```
GET /api/players/:id
```
Returns full player data (only called for results display):
```json
{
  "id": 123,
  "name": "Babe Ruth",
  "year": 1927,
  "team": "NYY",
  "position": "OF",
  "stats": { "R": 158, "HR": 60, "RBI": 164, "SB": 7, "AVG": 0.356 },
  "zScoreOverall": 4.21,
  "zScorePosition": 3.85,
  "starRating": 5
}
```

### Drafts

```
POST /api/drafts
```
Creates a new draft, returns draft ID.

```
GET /api/drafts/:id
```
Returns current draft state (picks made, available slots).

```
POST /api/drafts/:id/picks
Body: { "playerId": 123, "rosterSlot": "OF1" }
```
Validates and saves a pick.

```
POST /api/drafts/:id/complete
```
Completes the draft and triggers scoring:
1. Calculates category totals
2. Runs 12-team roto league simulation
3. Calculates win-loss record vs team pool
4. Detects outlier achievements
5. Generates AI commentary via OpenAI
6. Adds team to team_pool
7. Returns full results

```
GET /api/drafts/:id/results
```
Returns complete results for display.

### Leaderboard

```
GET /api/leaderboard?limit=50&period=all|week|month
```
Returns top scores.

```
GET /api/users/:userId/drafts
```
Returns user's draft history.

### Share

```
POST /api/share/:draftId
```
Generates shareable link and OG metadata.

## Scoring Service

The scoring service (`backend/src/services/scoring.ts`) handles all results calculations:

### 1. Category Totals
Sum stats across all 15 players for each of the 10 categories.

### 2. Roto League Simulation
```typescript
function simulateRotoLeague(team: TeamTotals, pool: TeamPool[]): RotoResult {
  // Sample 11 random teams from pool
  const opponents = sampleRandom(pool, 11);
  const league = [team, ...opponents];

  // For each category, rank teams 1-12
  // Sum points (1st = 12 pts, 12th = 1 pt)
  // Return placement and full scoreboard
}
```

### 3. Win-Loss Calculation
```typescript
function calculateWinLoss(team: TeamTotals, pool: TeamPool[]): string {
  // Compare head-to-head vs every team in pool
  // Win = beat in more categories than lost
  // Return "8432-1568" format
}
```

### 4. Outlier Detection
```typescript
function detectOutliers(team: TeamTotals, pool: TeamPool[]): string[] {
  // Check if team leads any category
  // Check for notable achievements (3rd best ERA, etc.)
  // Check for interesting patterns (3 players from same team)
  return ["Most stolen bases in the database!", ...];
}
```

### 5. AI Commentary
```typescript
async function generateCommentary(
  team: Pick[],
  results: ScoringResults
): Promise<string> {
  const prompt = buildPrompt(team, results);
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }]
  });
  return response.choices[0].message.content;
}
```

## Data Pipeline

The Python data pipeline processes Lahman Baseball Database CSVs:

1. **preprocess_batting.py** - Filter batters, merge with fielding for position eligibility
2. **preprocess_pitching.py** - Filter pitchers, assign SP/RP positions
3. **compute_zscores.py** - Calculate overall and position-relative z-scores
4. **generate_team_pool.py** - Create 10,000 simulated teams from elite pool
5. **load_to_postgres.py** - Load processed data into PostgreSQL

### Elite Pool for Simulated Teams
```python
# For each position, identify top ~250 player-seasons by position z-score
# Simulated teams randomly select from this pool
# Creates "reasonable but beatable" teams
```

## Future: Multiplayer Support

The architecture supports future multiplayer features:

- **drafts table** can store multiple user_ids for multiplayer
- **picks table** tracks which user made each pick
- **WebSocket layer** can be added for real-time synchronization
- **Timer service** can manage pick timeouts server-side

For now, solo mode uses simple REST API without real-time requirements.

## Environment Variables

```
# Backend
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
FRONTEND_URL=https://retromatic.app

# Frontend
VITE_API_URL=https://api.retromatic.app
```

## Local Development

```bash
# Start PostgreSQL
docker-compose up -d

# Run migrations
cd backend && npm run db:migrate

# Start backend
cd backend && npm run dev

# Start frontend
cd frontend && npm run dev
```
