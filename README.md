# Retromatic

A fantasy baseball draft game where you build your dream team from baseball history (1961-2023). Search through decades of legends, fill your 15-player roster, and see how you stack up against thousands of simulated teams.

## Features

- **Historical Draft**: Access player data from 1961-2023 via the Lahman Baseball Database
- **Position-Based Roster**: Fill 9 batter slots and 7 pitcher slots with eligible players
- **Hidden Stats During Draft**: Player stats are hidden until you complete your draft
- **Multi-Layered Scoring**:
  - Overall percentile ranking against 10,000+ teams
  - 12-team roto league simulation
  - Category-by-category breakdown (R, HR, RBI, SB, AVG, W, SV, K, ERA, WHIP)
  - Win-loss record against all teams in the database
- **AI Commentary**: OpenAI-powered personalized commentary about your team
- **Star Ratings**: Position-relative z-scores displayed as intuitive star ratings
- **Leaderboard**: Compete for the top spots on the global leaderboard

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript, Vite, Tailwind CSS, Framer Motion, React Query |
| Backend | Node.js + Express + TypeScript, Drizzle ORM |
| Database | PostgreSQL 15 |
| Data Pipeline | Python 3.11+ |
| AI | OpenAI API |

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+
- Docker & Docker Compose (for PostgreSQL)

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/retromatic.git
cd retromatic

# Install frontend dependencies
cd frontend && npm install && cd ..

# Install backend dependencies
cd backend && npm install && cd ..

# Install Python dependencies
cd data-pipeline && pip install -r requirements.txt && cd ..
```

### 2. Set Up Environment

```bash
cp .env.example .env
# Edit .env with your OPENAI_API_KEY if you want AI commentary
```

### 3. Start PostgreSQL

```bash
docker compose up -d
```

### 4. Load Data

```bash
python data-pipeline/preprocess-to-postgres.py data-preprocessing/lahman_1871-2023_csv
```

This will:
- Create database tables
- Process ~30K player-seasons from the Lahman database
- Generate 10,000 simulated teams for the comparison pool

### 5. Run the Application

```bash
# Terminal 1: Start backend
cd backend && npm run dev

# Terminal 2: Start frontend
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
retromatic/
├── frontend/               # React application (Vite + TypeScript)
│   ├── src/
│   │   ├── components/     # UI components (ui/, draft/, results/)
│   │   ├── pages/          # Page components
│   │   ├── hooks/          # React Query hooks
│   │   ├── lib/            # API client, utilities
│   │   └── types/          # TypeScript types
│   └── package.json
│
├── backend/                # Express API server
│   ├── src/
│   │   ├── routes/         # API routes (players, drafts, leaderboard)
│   │   ├── services/       # Business logic (scoring, commentary)
│   │   └── db/             # Drizzle schema and config
│   └── package.json
│
├── data-pipeline/          # Python data processing
│   ├── preprocess-to-postgres.py
│   └── requirements.txt
│
├── data-preprocessing/     # Source data (Lahman CSVs)
│   └── lahman_1871-2023_csv/
│
├── docker-compose.yml      # PostgreSQL setup
└── docs/                   # Documentation
```

## Roster Configuration

| Position | Slots | Notes |
|----------|-------|-------|
| C | 1 | Catcher |
| 1B | 1 | First Base |
| 2B | 1 | Second Base |
| 3B | 1 | Third Base |
| SS | 1 | Shortstop |
| OF | 3 | Outfield (LF/CF/RF eligible) |
| UTIL | 1 | Any batter |
| SP | 3 | Starting Pitcher |
| RP | 2 | Relief Pitcher |
| P | 2 | Any Pitcher |

## Scoring Categories

| Batting (5) | Pitching (5) |
|-------------|--------------|
| Runs (R) | Wins (W) |
| Home Runs (HR) | Saves (SV) |
| RBIs (RBI) | Strikeouts (K) |
| Stolen Bases (SB) | ERA (lower is better) |
| Batting Average (AVG) | WHIP (lower is better) |

## API Endpoints

```
GET  /api/players/search?q={name}    # Search players (name only, no stats)
GET  /api/players/:id                # Get player details (after draft)
POST /api/drafts                     # Create new draft
GET  /api/drafts/:id                 # Get draft state
POST /api/drafts/:id/picks           # Make a pick
POST /api/drafts/:id/complete        # Complete draft and score
GET  /api/drafts/:id/results         # Get full results
GET  /api/leaderboard                # Get top scores
GET  /api/leaderboard/user/:token/drafts  # Get user's drafts
```

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- [Lahman Baseball Database](http://www.seanlahman.com/baseball-archive/statistics/) for historical baseball statistics
- [shadcn/ui](https://ui.shadcn.com/) for design inspiration
- [OpenAI](https://openai.com/) for AI commentary generation
