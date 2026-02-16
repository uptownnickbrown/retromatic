# Sandlot

A mobile-first daily fantasy baseball draft challenge. Pick from curated historical MLB player-seasons (1961-2023) and see how your lineup stacks up.

## How It Works

1. **Daily Challenge**: Every day, a new set of 10 draft rounds goes live. Same slate for everyone.
2. **Pick Your Lineup**: Each round shows 3 legendary players with 3 year options each. You have 30 seconds to pick.
3. **Legend Score**: Every pick gets a Legend Score (1-10) based on how dominant that player was at their position that year.
4. **Compare**: See what % of other players picked each option, and how your total score ranks.

## Development Setup

### Prerequisites
- Node.js 18+
- Docker (for PostgreSQL)
- Python 3.10+ with pip (for data pipeline, one-time setup)

### Quick Start

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Set up backend
cd backend
cp .env.example .env    # Edit with your keys
npm install
npx drizzle-kit push    # Create database tables
npm run dev             # Starts on http://localhost:3001

# 3. Set up frontend (new terminal)
cd frontend
npm install
npm run dev             # Starts on http://localhost:3000

# 4. Load player data (one-time)
cd data-pipeline
pip install -r requirements.txt
python preprocess-to-postgres.py ../data-preprocessing/lahman_1871-2023_csv
```

### Data Source

Player statistics come from the [Lahman Baseball Database](http://www.seanlahman.com/baseball-archive/statistics/) (1871-2023, CC BY-SA 3.0). See `data-preprocessing/README.md` for download instructions.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Framer Motion
- **Backend**: Express 5, TypeScript, Drizzle ORM, PostgreSQL
- **AI**: OpenAI API for player blurbs (optional)
- **Data**: Python preprocessing with pandas, numpy, scipy

## Acknowledgments

- [Lahman Baseball Database](http://www.seanlahman.com/baseball-archive/statistics/) for historical baseball statistics
- [OpenAI](https://openai.com/) for AI-generated player blurbs
