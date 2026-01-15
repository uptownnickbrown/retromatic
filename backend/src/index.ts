import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import playersRouter from './routes/players.js';
import draftsRouter from './routes/drafts.js';
import leaderboardRouter from './routes/leaderboard.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/players', playersRouter);
app.use('/api/drafts', draftsRouter);
app.use('/api/leaderboard', leaderboardRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
