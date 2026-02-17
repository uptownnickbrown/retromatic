import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import challengeRouter from './routes/challenge.js';
import leaderboardRouter from './routes/leaderboard.js';
import adminRouter from './routes/admin.js';
import { activateTodaysChallenge } from './services/dailyScheduler.js';

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
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/admin', adminRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// On startup, try to activate today's challenge
activateTodaysChallenge()
  .then(result => {
    if (result.activated) console.log(`Activated challenge ${result.activated} for today`);
    if (result.completed) console.log(`Completed ${result.completed} past challenges`);
  })
  .catch(err => console.error('Scheduler error on startup:', err));

app.listen(PORT, () => {
  console.log(`Sandlot API running on port ${PORT}`);
});

export default app;
