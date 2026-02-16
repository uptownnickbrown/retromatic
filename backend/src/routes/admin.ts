import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { challenges, challengeRounds, roundOptions } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { generateChallenge, generateBatch, scheduleChallenges } from '../services/challengeGenerator.js';
import { generateBlurbsForChallenge } from '../services/challengeBlurbs.js';
import { activateTodaysChallenge } from '../services/dailyScheduler.js';

const router = Router();

// Admin auth middleware
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const secret = req.headers['x-admin-secret'];
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

router.use(requireAdmin);

// Generate a new challenge
router.post('/challenges/generate', async (req, res) => {
  try {
    const { count = 1, theme, positionOrder } = req.body;
    const ids = await generateBatch(count, { theme, positionOrder });
    res.json({ challengeIds: ids, count: ids.length });
  } catch (error) {
    console.error('Challenge generation error:', error);
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

// List all challenges
router.get('/challenges', async (req, res) => {
  try {
    const allChallenges = await db.select()
      .from(challenges)
      .orderBy(desc(challenges.id));
    res.json({ challenges: allChallenges });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list challenges' });
  }
});

// Get challenge details
router.get('/challenges/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [challenge] = await db.select().from(challenges).where(eq(challenges.id, id));
    if (!challenge) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }

    const rounds = await db.select()
      .from(challengeRounds)
      .where(eq(challengeRounds.challengeId, id))
      .orderBy(challengeRounds.roundNumber);

    const roundsWithOptions = await Promise.all(rounds.map(async (round) => {
      const options = await db.select()
        .from(roundOptions)
        .where(eq(roundOptions.roundId, round.id))
        .orderBy(roundOptions.playerSlot);

      return { ...round, options };
    }));

    res.json({ challenge, rounds: roundsWithOptions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get challenge' });
  }
});

// Update challenge
router.patch('/challenges/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, theme, challengeDate, positionOrder } = req.body;

    const updates: Record<string, any> = {};
    if (status) updates.status = status;
    if (theme !== undefined) updates.theme = theme;
    if (challengeDate) updates.challengeDate = challengeDate;
    if (positionOrder) updates.positionOrder = positionOrder;

    const [updated] = await db.update(challenges)
      .set(updates)
      .where(eq(challenges.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }

    res.json({ challenge: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update challenge' });
  }
});

// Delete challenge
router.delete('/challenges/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [deleted] = await db.delete(challenges)
      .where(eq(challenges.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }

    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete challenge' });
  }
});

// Generate AI blurbs for a challenge
router.post('/challenges/:id/blurbs', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await generateBlurbsForChallenge(id);
    res.json(result);
  } catch (error) {
    console.error('Blurb generation error:', error);
    res.status(500).json({ error: 'Failed to generate blurbs' });
  }
});

// Schedule challenges (assign dates)
router.post('/challenges/schedule', async (req, res) => {
  try {
    const { challengeIds, startDate } = req.body;
    if (!challengeIds?.length || !startDate) {
      res.status(400).json({ error: 'challengeIds and startDate required' });
      return;
    }
    await scheduleChallenges(challengeIds, startDate);
    res.json({ scheduled: challengeIds.length, startDate });
  } catch (error) {
    res.status(500).json({ error: 'Failed to schedule challenges' });
  }
});

// Manually activate today's challenge
router.post('/activate-today', async (req, res) => {
  try {
    const result = await activateTodaysChallenge();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to activate challenge' });
  }
});

export default router;
