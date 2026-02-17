import { Router } from 'express';
import { db } from '../db/index.js';
import { gameSessions, challenges } from '../db/schema.js';
import { eq, desc, gte, and, sql } from 'drizzle-orm';
import { toNum } from '../lib/numeric.js';
import { getTodayET } from '../lib/date.js';

const router = Router();

// GET /api/leaderboard - Get leaderboard
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const period = req.query.period as string || 'today';

    const today = getTodayET();

    let dateFilter;
    switch (period) {
      case 'today':
        dateFilter = today;
        break;
      case 'week': {
        const weekAgo = new Date(new Date().getTime() - 7 * 24 * 60 * 60 * 1000);
        dateFilter = weekAgo.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        break;
      }
      default:
        dateFilter = null; // all time
    }

    // For "today", get scores for today's challenge only
    // For "week" or "alltime", aggregate best scores
    let leaderboard;

    if (period === 'today') {
      leaderboard = await db.select({
        guestToken: gameSessions.guestToken,
        totalLegendScore: gameSessions.totalLegendScore,
        percentile: gameSessions.percentile,
        completedAt: gameSessions.completedAt,
      })
        .from(gameSessions)
        .innerJoin(challenges, eq(gameSessions.challengeId, challenges.id))
        .where(and(
          eq(gameSessions.status, 'completed'),
          eq(challenges.challengeDate, today)
        ))
        .orderBy(desc(gameSessions.totalLegendScore))
        .limit(limit);
    } else {
      // For week/alltime, show best single-day score per user
      const conditions = [eq(gameSessions.status, 'completed')];
      if (dateFilter) {
        conditions.push(gte(challenges.challengeDate, dateFilter));
      }

      leaderboard = await db.select({
        guestToken: gameSessions.guestToken,
        totalLegendScore: sql<string>`max(${gameSessions.totalLegendScore})`,
        percentile: sql<number>`max(${gameSessions.percentile})`,
        completedAt: sql<Date>`max(${gameSessions.completedAt})`,
      })
        .from(gameSessions)
        .innerJoin(challenges, eq(gameSessions.challengeId, challenges.id))
        .where(and(...conditions))
        .groupBy(gameSessions.guestToken)
        .orderBy(desc(sql`max(${gameSessions.totalLegendScore})`))
        .limit(limit);
    }

    const ranked = leaderboard.map((entry, index) => ({
      rank: index + 1,
      displayName: `Player_${entry.guestToken?.substring(0, 6) || 'anon'}`,
      score: toNum(entry.totalLegendScore),
      percentile: toNum(entry.percentile, 50),
      completedAt: entry.completedAt,
    }));

    res.json({ leaderboard: ranked, period });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// GET /api/leaderboard/streak - Get current user's streak
router.get('/streak', async (req, res) => {
  try {
    const guestToken = req.headers['x-guest-token'] as string;
    if (!guestToken) {
      res.json({ current: 0, longest: 0 });
      return;
    }

    // Get all completed challenge dates for this user, ordered desc
    const sessions = await db.select({
      date: challenges.challengeDate,
    })
      .from(gameSessions)
      .innerJoin(challenges, eq(gameSessions.challengeId, challenges.id))
      .where(and(
        eq(gameSessions.guestToken, guestToken),
        eq(gameSessions.status, 'completed')
      ))
      .orderBy(desc(challenges.challengeDate));

    if (sessions.length === 0) {
      res.json({ current: 0, longest: 0 });
      return;
    }

    // Calculate streaks
    const dates = sessions.map(s => s.date);
    const today = getTodayET();

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 1;

    // Check if streak includes today or yesterday
    const firstDate = new Date(dates[0]);
    const todayDate = new Date(today);
    const diffDays = Math.floor((todayDate.getTime() - firstDate.getTime()) / (86400000));

    if (diffDays <= 1) {
      currentStreak = 1;

      // Count consecutive days backwards
      for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1]);
        const curr = new Date(dates[i]);
        const diff = Math.floor((prev.getTime() - curr.getTime()) / 86400000);

        if (diff === 1) {
          currentStreak++;
          tempStreak++;
        } else {
          longestStreak = Math.max(longestStreak, tempStreak);
          tempStreak = 1;
        }
      }
    }

    longestStreak = Math.max(longestStreak, tempStreak, currentStreak);

    res.json({ current: currentStreak, longest: longestStreak });
  } catch (error) {
    console.error('Streak error:', error);
    res.status(500).json({ error: 'Failed to calculate streak' });
  }
});

export default router;
