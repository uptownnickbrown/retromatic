import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import challengeRouter from './routes/challenge.js';
import adminRouter from './routes/admin.js';
import { promoteNextChallenge, startMidnightScheduler } from './services/dailyScheduler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// Routes
app.use('/api/challenge', challengeRouter);
app.use('/api/admin', adminRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Production static file serving ---
// In dev, Vite handles frontend on :3000 and proxies /api to Express on :3001.
// In production (Railway), Express serves everything: API + portraits + frontend.
if (process.env.NODE_ENV === 'production') {
  // Portraits: serve from PORTRAIT_DIR (Railway Volume) or frontend/dist/portraits/
  const portraitDir = process.env.PORTRAIT_DIR
    || path.resolve(import.meta.dirname ?? process.cwd(), '../../frontend/dist/portraits');

  if (fs.existsSync(portraitDir) || process.env.PORTRAIT_DIR) {
    if (process.env.PORTRAIT_DIR && !fs.existsSync(portraitDir)) {
      fs.mkdirSync(portraitDir, { recursive: true });
    }
    app.use('/portraits', express.static(portraitDir, {
      maxAge: '1h',
    }));
    console.log(`Serving portraits from ${portraitDir}`);
  }

  // Frontend: serve the Vite build output
  const frontendDist = path.resolve(
    import.meta.dirname ?? process.cwd(),
    '../../frontend/dist',
  );

  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist, {
      maxAge: '1d',
      index: false,
    }));

    // SPA catch-all: serve index.html for all unmatched GET requests (React Router)
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
    console.log(`Serving frontend from ${frontendDist}`);
  }
}

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// On startup, promote today's challenge if needed, then start midnight scheduler
promoteNextChallenge()
  .then(result => {
    if (result.activated) console.log(`Activated challenge #${result.activated} for today`);
    if (result.completed) console.log(`Completed ${result.completed} past challenge(s)`);
  })
  .catch(err => console.error('Scheduler error on startup:', err));

startMidnightScheduler();

app.listen(PORT, () => {
  console.log(`Sandlot API running on port ${PORT}`);
});

export default app;
