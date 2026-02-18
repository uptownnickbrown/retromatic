# Railway Deployment Guide

Handoff document for deploying Sandlot to Railway. All code changes are complete and tested. What remains is Railway project setup (via CLI), database seeding, and portrait migration.

## What Was Done (This Branch)

### New Files
- **`package.json`** (root) — Orchestrates building both frontend and backend. Nixpacks (Railway's builder) runs `npm install` at root, then `npm run build`, which builds both packages. `npm start` runs schema migration then starts Express.
- **`railway.toml`** — Railway deployment config: Nixpacks builder, health check on `/api/health`, restart-on-failure policy.
- **`.node-version`** — Pins Node 22 (required for `import.meta.dirname`).

### Modified Files
- **`backend/src/index.ts`** — Added production static file serving block (gated behind `NODE_ENV=production`):
  - Serves portraits from `PORTRAIT_DIR` env var (Railway Volume)
  - Serves frontend build output from `frontend/dist/`
  - SPA catch-all serves `index.html` for React Router
  - In dev mode, this block is entirely skipped — no change to local workflow
- **`backend/src/services/portraitGenerator.ts`** — Portrait directory now reads from `PORTRAIT_DIR` env var, falls back to `frontend/public/portraits/` for dev.
- **`backend/src/services/challengeBlurbs.ts`** — Fixed pre-existing type error (line 357).
- **`frontend/src/lib/adminApi.ts`** — Fixed pre-existing type mismatch in `preseedStats` return type (added `syntheticSessions` field).

### Verified Locally
- Backend TypeScript compiles clean
- Frontend Vite build succeeds
- Production mode tested: health check, frontend serving, SPA routing, static assets all work
- Dev mode unaffected (the production block is skipped when `NODE_ENV !== 'production'`)

---

## What Remains

### 1. Install Railway CLI
```bash
npm install -g @railway/cli
railway login
```
This opens a browser for OAuth. Alternatively, create an API token at https://railway.app/account/tokens and use:
```bash
export RAILWAY_TOKEN=<your-token>
```

### 2. Create Railway Project
```bash
cd /path/to/retromatic
railway init
# Choose "Empty Project" or connect to GitHub repo
```

If connecting to GitHub (recommended for auto-deploys):
```bash
railway link
# Select the GitHub repo
```

### 3. Add PostgreSQL Database
```bash
railway add --plugin postgresql
```
This provisions a managed Postgres instance. Railway auto-creates a `DATABASE_URL` variable that the web service can reference.

### 4. Add Railway Volume for Portraits
**This likely requires the Railway dashboard** (CLI volume support is limited):
1. Go to your project at https://railway.app
2. Click the web service
3. Settings → Volumes → Mount Volume
4. Set mount path: `/data/portraits`

This volume persists portrait PNGs across deploys and restarts.

### 5. Set Environment Variables
```bash
railway variables set NODE_ENV=production
railway variables set PORTRAIT_DIR=/data/portraits
railway variables set ADMIN_SECRET=<your-secret>
railway variables set OPENAI_API_KEY=<your-key>  # optional, for AI blurbs
```

**Notes:**
- `DATABASE_URL` — Railway may auto-link this from the PostgreSQL plugin. If not: `railway variables set DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `PORT` — Do NOT set this. Railway injects it automatically.

### 6. Deploy
If connected to GitHub, pushing to your main branch triggers a deploy automatically.

For manual deploy:
```bash
railway up
```

Watch logs:
```bash
railway logs
```

Expected startup sequence:
1. Nixpacks detects Node.js, runs `npm install` then `npm run build`
2. Build installs both frontend + backend deps, compiles TypeScript, runs Vite build
3. Start command runs `drizzle-kit push` (creates/updates DB tables), then starts Express
4. Health check at `/api/health` turns green
5. Logs show: `Serving portraits from /data/portraits` and `Serving frontend from .../frontend/dist`

### 7. Seed the Database with Player Data

The `players` table (~36,500 records) needs the Python data pipeline. Run it locally against the Railway database:

```bash
# Get the public DATABASE_URL from Railway
railway variables get DATABASE_URL
# Or find it in the Railway dashboard under the PostgreSQL service

# Run the pipeline
DATABASE_URL="postgresql://postgres:xxxxx@roundhouse.proxy.rlwy.net:12345/railway" \
  python data-pipeline/preprocess-to-postgres.py data-preprocessing/lahman_1871-2025_csv
```

**Alternative: pg_dump/pg_restore from your local database**
```bash
# Dump all relevant tables from local DB
pg_dump -h localhost -U retromatic -d retromatic \
  -t players -t challenges -t challenge_rounds -t round_options \
  -t pick_stats \
  --data-only -Fc > sandlot_data.dump

# Get Railway's public connection details
railway variables get DATABASE_URL

# Restore to Railway (use the host, port, user, dbname from the URL)
pg_restore -h <railway-host> -p <railway-port> -U <railway-user> -d <railway-db> \
  --no-owner --no-privileges \
  sandlot_data.dump
```

This migrates everything: players, challenges, rounds, options (with blurbs), and preseeded stats.

### 8. Migrate Portrait Files

Portraits on your laptop are at `frontend/public/portraits/`. They need to go to the Railway Volume at `/data/portraits`.

**Option A: rsync via Railway CLI** (if `railway shell` or `railway run` is available)
```bash
# This may or may not work depending on Railway CLI capabilities
railway run bash -c "ls /data/portraits"  # test if you can access the volume
```

**Option B: Upload via the app**
Since portraits are generated via the admin API (`POST /api/admin/challenges/:id/portraits`), you can regenerate them on Railway after deploying. But this uses OpenAI API credits.

**Option C: Temporary upload endpoint**
If you have many portraits to migrate, we can add a temporary admin endpoint that accepts portrait uploads. This can be added and removed in a follow-up.

**Option D: Use Railway's Postgres for portraits**
If volume access proves difficult, we could store portraits as binary in the database. This adds complexity but avoids filesystem concerns entirely. Not recommended unless volumes prove problematic.

**Recommended approach**: Try Option A first. If `railway run` can access the volume, a simple copy script works. Otherwise, regenerate portraits via admin API (Option B) — it's the cleanest path and ensures portraits are generated with the correct quality settings.

---

## Architecture Overview

### Local Development (unchanged)
```
Terminal 1: docker compose up -d              # PostgreSQL on :5432
Terminal 2: cd backend && npm run dev         # Express API on :3001
Terminal 3: cd frontend && npm run dev        # Vite dev server on :3000

Browser → localhost:3000 → Vite serves frontend
                         → /api/* proxied to Express on :3001
                         → /portraits/* served from frontend/public/portraits/
```

### Production (Railway)
```
Single Railway Service:
  Express on Railway's PORT serves everything:
    /api/*        → Express routes
    /portraits/*  → Railway Volume (/data/portraits)
    /*            → Frontend static files (frontend/dist/)
    catch-all     → index.html (SPA routing)

Railway Managed PostgreSQL → DATABASE_URL auto-injected
Railway Volume             → /data/portraits (persistent)
```

### How Portraits Work Across Environments
- **DB stores**: `/portraits/{playerId}.png` (relative URL, works everywhere)
- **Dev**: Vite serves from `frontend/public/portraits/`, backend writes to same dir
- **Prod**: Express serves from `PORTRAIT_DIR` (`/data/portraits`), backend writes to same dir
- **Key env var**: `PORTRAIT_DIR=/data/portraits` (set only in production)

---

## Environment Variables Reference

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | Yes | `postgresql://retromatic:retromatic_dev@localhost:5432/retromatic` | Railway auto-links from PostgreSQL plugin |
| `PORT` | No | `3001` | Railway injects this — do NOT set manually |
| `NODE_ENV` | Yes (prod) | unset | Set to `production` on Railway |
| `PORTRAIT_DIR` | Yes (prod) | `frontend/public/portraits/` | Set to `/data/portraits` (Railway Volume mount) |
| `ADMIN_SECRET` | Yes | none | Protects admin API routes |
| `OPENAI_API_KEY` | No | none | For AI blurb generation; falls back to templates |

---

## Troubleshooting

### Build fails: "Cannot find module..."
The build command in root `package.json` runs `npm ci` in both `frontend/` and `backend/`. If lockfiles are out of date, use `npm install` instead of `npm ci` (edit root `package.json`).

### Health check fails
Check Railway logs (`railway logs`). Common causes:
- `DATABASE_URL` not set or PostgreSQL not provisioned
- Port mismatch (don't set `PORT` manually)

### Portraits not persisting across deploys
Verify the Railway Volume is mounted at `/data/portraits` and `PORTRAIT_DIR=/data/portraits` is set in environment variables.

### SPA routes return 404
This means the frontend `dist/` wasn't built or the static serving block isn't running. Check that `NODE_ENV=production` is set and that the build completed successfully (look for "Serving frontend from..." in logs).

### `drizzle-kit push` fails on startup
If the database is unreachable, the start command will fail. Verify `DATABASE_URL` is correct. You can also run migrations manually:
```bash
railway run npx drizzle-kit push
```
