import { Router } from 'express';
import { db } from '../db/index.js';
import { drafts, teamPool } from '../db/schema.js';
import { eq, desc, gte, and, sql, isNotNull } from 'drizzle-orm';

const router = Router();

// Get leaderboard
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const period = req.query.period as string || 'all';

    let dateFilter;
    const now = new Date();

    switch (period) {
      case 'week':
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        dateFilter = null;
    }

    let query = db.select({
      id: drafts.id,
      guestToken: drafts.guestToken,
      totalScore: drafts.totalScore,
      percentile: drafts.percentile,
      rotoPlacement: drafts.rotoPlacement,
      completedAt: drafts.completedAt,
    })
      .from(drafts)
      .where(eq(drafts.status, 'completed'));

    if (dateFilter) {
      query = query.where(
        and(
          eq(drafts.status, 'completed'),
          gte(drafts.completedAt, dateFilter)
        )
      );
    }

    const leaderboard = await query
      .orderBy(desc(drafts.totalScore))
      .limit(limit);

    // Add rank
    const rankedLeaderboard = leaderboard.map((entry, index) => ({
      rank: index + 1,
      displayName: `Guest_${entry.guestToken?.substring(0, 6) || 'anon'}`,
      score: parseFloat(entry.totalScore as string || '0'),
      percentile: entry.percentile,
      rotoPlacement: entry.rotoPlacement,
      completedAt: entry.completedAt,
      draftId: entry.id,
    }));

    // Get total count
    const totalResult = await db.select({
      count: sql<number>`count(*)`,
    })
      .from(drafts)
      .where(eq(drafts.status, 'completed'));

    res.json({
      leaderboard: rankedLeaderboard,
      totalTeams: totalResult[0].count,
      period,
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Get user's drafts
router.get('/user/:guestToken/drafts', async (req, res) => {
  try {
    const { guestToken } = req.params;

    const userDrafts = await db.select({
      id: drafts.id,
      status: drafts.status,
      totalScore: drafts.totalScore,
      percentile: drafts.percentile,
      rotoPlacement: drafts.rotoPlacement,
      createdAt: drafts.createdAt,
      completedAt: drafts.completedAt,
    })
      .from(drafts)
      .where(eq(drafts.guestToken, guestToken))
      .orderBy(desc(drafts.createdAt));

    res.json({ drafts: userDrafts });
  } catch (error) {
    console.error('User drafts error:', error);
    res.status(500).json({ error: 'Failed to fetch user drafts' });
  }
});

// Get user's rank
router.get('/user/:guestToken/rank', async (req, res) => {
  try {
    const { guestToken } = req.params;

    // Get user's best score
    const userBest = await db.select({
      totalScore: drafts.totalScore,
    })
      .from(drafts)
      .where(and(
        eq(drafts.guestToken, guestToken),
        eq(drafts.status, 'completed')
      ))
      .orderBy(desc(drafts.totalScore))
      .limit(1);

    if (userBest.length === 0) {
      return res.json({ rank: null, totalTeams: 0 });
    }

    const userScore = userBest[0].totalScore;

    // Count teams with higher scores
    const rankResult = await db.select({
      count: sql<number>`count(*)`,
    })
      .from(drafts)
      .where(and(
        eq(drafts.status, 'completed'),
        sql`${drafts.totalScore} > ${userScore}`
      ));

    const totalResult = await db.select({
      count: sql<number>`count(*)`,
    })
      .from(drafts)
      .where(eq(drafts.status, 'completed'));

    res.json({
      rank: rankResult[0].count + 1,
      totalTeams: totalResult[0].count,
      bestScore: parseFloat(userScore as string || '0'),
    });
  } catch (error) {
    console.error('User rank error:', error);
    res.status(500).json({ error: 'Failed to fetch user rank' });
  }
});

export default router;
