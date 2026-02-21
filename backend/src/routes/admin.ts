import { Router } from 'express';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { db } from '../db/index.js';
import { challenges, challengeRounds, roundOptions, gameSessions, userPicks, players } from '../db/schema.js';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { generateBatch, queueChallenges, generateThemedBatch } from '../services/challengeGenerator.js';
import { generateBlurbsForChallenge, generateBlurbsForOption } from '../services/challengeBlurbs.js';
import { generatePortraitsForChallenge, generatePortraitForOption } from '../services/portraitGenerator.js';
import { preseedStatsForChallenge } from '../services/statsPreseeder.js';
import { promoteNextChallenge } from '../services/dailyScheduler.js';
import { calculateLegendScore } from '../services/legendScore.js';
import { toNum } from '../lib/numeric.js';
import { getAllRoundData } from './challenge.js';

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
    const { count = 1, theme, positionOrder, date } = req.body;
    const ids = await generateBatch(count, { theme, positionOrder, date });
    res.json({ challengeIds: ids, count: ids.length });
  } catch (error) {
    console.error('Challenge generation error:', error);
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

// Generate themed challenges in batch
router.post('/challenges/generate-themed', async (req, res) => {
  try {
    const { count = 25 } = req.body;
    const clampedCount = Math.min(Math.max(1, count), 50);
    const result = await generateThemedBatch(clampedCount);
    res.json({ challengeIds: result.challengeIds, count: result.challengeIds.length, themes: result.themes });
  } catch (error) {
    console.error('Themed generation error:', error);
    res.status(500).json({ error: 'Failed to generate themed challenges' });
  }
});

// Queue challenges (add to the auto-promote queue) — must be before :id routes
router.post('/challenges/queue', async (req, res) => {
  try {
    const { challengeIds } = req.body;
    if (!challengeIds?.length) {
      res.status(400).json({ error: 'challengeIds required' });
      return;
    }
    await queueChallenges(challengeIds);
    res.json({ queued: challengeIds.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to queue challenges' });
  }
});

// Dequeue challenge (remove from queue, back to draft)
router.post('/challenges/dequeue', async (req, res) => {
  try {
    const { challengeId } = req.body;
    if (!challengeId) {
      res.status(400).json({ error: 'challengeId required' });
      return;
    }
    const [updated] = await db.update(challenges)
      .set({ status: 'draft', publishedAt: null })
      .where(and(
        eq(challenges.id, challengeId),
        eq(challenges.status, 'scheduled'),
      ))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Challenge not found or not queued' });
      return;
    }
    res.json({ dequeued: true, challengeId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to dequeue challenge' });
  }
});

// History: completed challenges with audience stats
router.get('/challenges/history', async (req, res) => {
  try {
    const history = await db.select({
      id: challenges.id,
      challengeDate: challenges.challengeDate,
      theme: challenges.theme,
      status: challenges.status,
      createdAt: challenges.createdAt,
      playerCount: sql<number>`count(distinct case when ${gameSessions.status} = 'completed' then ${gameSessions.id} end)`,
      avgScore: sql<number>`round(avg(case when ${gameSessions.status} = 'completed' then ${gameSessions.totalLegendScore}::numeric end)::numeric, 1)`,
      bestScore: sql<number>`max(case when ${gameSessions.status} = 'completed' then ${gameSessions.totalLegendScore}::numeric end)`,
    })
      .from(challenges)
      .leftJoin(gameSessions, eq(gameSessions.challengeId, challenges.id))
      .where(eq(challenges.status, 'completed'))
      .groupBy(challenges.id)
      .orderBy(desc(challenges.challengeDate));

    res.json({ challenges: history });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Pipeline: all non-completed challenges with health summaries
router.get('/challenges/pipeline', async (req, res) => {
  try {
    const includeCompleted = req.query.includeCompleted === 'true';

    let allChallenges;
    if (includeCompleted) {
      allChallenges = await db.select().from(challenges).orderBy(desc(challenges.id));
    } else {
      allChallenges = await db.select().from(challenges)
        .where(sql`${challenges.status} != 'completed'`)
        .orderBy(desc(challenges.id));
    }

    const pipeline = await Promise.all(allChallenges.map(async (challenge) => {
      const rounds = await db.select({ id: challengeRounds.id })
        .from(challengeRounds)
        .where(eq(challengeRounds.challengeId, challenge.id));

      const roundIds = rounds.map(r => r.id);
      let blurbsMissing = 0;
      let portraitsMissing = 0;
      let totalPlayerSlots = 0;
      let totalYearOptions = 0;

      if (roundIds.length > 0) {
        const options = await db.select({
          portraitUrl: roundOptions.portraitUrl,
          blurbs: roundOptions.blurbs,
          yearOptions: roundOptions.yearOptions,
        })
          .from(roundOptions)
          .where(inArray(roundOptions.roundId, roundIds));

        for (const opt of options) {
          totalPlayerSlots++;
          const years = (opt.yearOptions as number[]) || [];
          totalYearOptions += years.length;
          if (!opt.portraitUrl) portraitsMissing++;
          const blurbs = (opt.blurbs ?? {}) as Record<string, string>;
          for (const year of years) {
            if (!blurbs[String(year)]?.trim()) blurbsMissing++;
          }
        }
      }

      return {
        ...challenge,
        health: {
          rounds: rounds.length,
          roundsReady: rounds.length === 10,
          playerSlots: totalPlayerSlots,
          blurbsMissing,
          blurbsReady: blurbsMissing === 0 && totalYearOptions > 0,
          portraitsMissing,
          portraitsReady: portraitsMissing === 0 && totalPlayerSlots > 0,
        },
      };
    }));

    res.json({ challenges: pipeline });
  } catch (error) {
    console.error('Pipeline error:', error);
    res.status(500).json({ error: 'Failed to fetch pipeline' });
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

// Get challenge details (enriched with z-scores for Legend Score display)
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

    // Collect all player-year pairs for batch z-score lookup
    const allOptions: Array<typeof roundOptions.$inferSelect> = [];
    const roundsWithOptions = await Promise.all(rounds.map(async (round) => {
      const options = await db.select()
        .from(roundOptions)
        .where(eq(roundOptions.roundId, round.id))
        .orderBy(roundOptions.playerSlot);
      allOptions.push(...options);
      return { ...round, options };
    }));

    // Batch-fetch player z-scores
    const playerYearPairs: Array<{ playerId: string; year: number }> = [];
    for (const opt of allOptions) {
      for (const year of (opt.yearOptions as number[])) {
        playerYearPairs.push({ playerId: opt.playerId, year });
      }
    }

    const zScoreMap = new Map<string, number>();
    if (playerYearPairs.length > 0) {
      const whereClauses = playerYearPairs.map(
        p => sql`(${players.playerId} = ${p.playerId} AND ${players.year} = ${p.year})`
      );
      const combined = sql.join(whereClauses, sql` OR `);
      const records = await db.select({
        playerId: players.playerId,
        year: players.year,
        zScorePosition: players.zScorePosition,
      }).from(players).where(combined);

      for (const r of records) {
        zScoreMap.set(`${r.playerId}-${r.year}`, toNum(r.zScorePosition));
      }
    }

    // Enrich options with z-scores
    const enrichedRounds = roundsWithOptions.map(round => ({
      ...round,
      options: round.options.map(opt => ({
        ...opt,
        yearScores: (opt.yearOptions as number[]).map(year => ({
          year,
          zScorePosition: zScoreMap.get(`${opt.playerId}-${year}`) ?? 0,
          legendScore: calculateLegendScore(zScoreMap.get(`${opt.playerId}-${year}`) ?? 0),
        })),
      })),
    }));

    res.json({ challenge, rounds: enrichedRounds });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get challenge' });
  }
});

// Health check for a single challenge
router.get('/challenges/:id/health', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [challenge] = await db.select().from(challenges).where(eq(challenges.id, id));
    if (!challenge) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }

    const rounds = await db.select()
      .from(challengeRounds)
      .where(eq(challengeRounds.challengeId, id));

    const roundIds = rounds.map(r => r.id);
    const allOptions = roundIds.length > 0
      ? await db.select().from(roundOptions).where(inArray(roundOptions.roundId, roundIds))
      : [];

    let totalPlayerSlots = 0;
    let blurbsPresent = 0;
    let blurbsMissing = 0;
    let portraitsPresent = 0;
    let portraitsMissing = 0;
    let totalYearOptions = 0;

    const playerYearPairs: Array<{ playerId: string; year: number }> = [];

    for (const opt of allOptions) {
      totalPlayerSlots++;
      const years = (opt.yearOptions as number[]) || [];
      totalYearOptions += years.length;

      if (opt.portraitUrl) portraitsPresent++;
      else portraitsMissing++;

      const blurbs = (opt.blurbs ?? {}) as Record<string, string>;
      for (const year of years) {
        if (blurbs[String(year)]?.trim()) {
          blurbsPresent++;
        } else {
          blurbsMissing++;
        }
        playerYearPairs.push({ playerId: opt.playerId, year });
      }
    }

    // Compute Legend Score range
    let minLegendScore: number | null = null;
    let maxLegendScore: number | null = null;

    if (playerYearPairs.length > 0) {
      const whereClauses = playerYearPairs.map(
        p => sql`(${players.playerId} = ${p.playerId} AND ${players.year} = ${p.year})`
      );
      const combined = sql.join(whereClauses, sql` OR `);
      const records = await db.select({ zScorePosition: players.zScorePosition })
        .from(players).where(combined);

      for (const r of records) {
        const ls = calculateLegendScore(toNum(r.zScorePosition));
        if (minLegendScore === null || ls < minLegendScore) minLegendScore = ls;
        if (maxLegendScore === null || ls > maxLegendScore) maxLegendScore = ls;
      }
    }

    res.json({
      challengeId: id,
      status: challenge.status,
      rounds: rounds.length,
      roundsExpected: 10,
      roundsReady: rounds.length === 10,
      playerSlots: totalPlayerSlots,
      playerSlotsExpected: 30,
      blurbs: { present: blurbsPresent, missing: blurbsMissing, total: totalYearOptions },
      blurbsReady: blurbsMissing === 0 && blurbsPresent > 0,
      portraits: { present: portraitsPresent, missing: portraitsMissing, total: totalPlayerSlots },
      portraitsReady: portraitsMissing === 0 && portraitsPresent > 0,
      legendScoreRange: minLegendScore !== null ? { min: minLegendScore, max: maxLegendScore } : null,
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ error: 'Failed to compute health' });
  }
});

// Playtest: start a challenge regardless of status (no real session)
router.post('/challenges/:id/playtest', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);

    const [challenge] = await db.select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!challenge) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }

    const { rounds, communityStats } = await getAllRoundData(challengeId);

    res.json({
      session: { id: `playtest-${challengeId}-${Date.now()}`, status: 'playtest' },
      challenge: {
        id: challenge.id,
        date: challenge.challengeDate,
        positionOrder: challenge.positionOrder,
        theme: challenge.theme,
        totalRounds: 10,
      },
      rounds,
      communityStats,
    });
  } catch (error) {
    console.error('Playtest error:', error);
    res.status(500).json({ error: 'Failed to start playtest' });
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

// Regenerate portrait for a single player option
router.post('/options/:optionId/portrait', async (req, res) => {
  try {
    const optionId = parseInt(req.params.optionId);
    const result = await generatePortraitForOption(optionId);
    res.json(result);
  } catch (error: any) {
    console.error('Single portrait generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate portrait' });
  }
});

// Regenerate blurbs for a single player option (all year options)
router.post('/options/:optionId/blurbs', async (req, res) => {
  try {
    const optionId = parseInt(req.params.optionId);
    const result = await generateBlurbsForOption(optionId);
    res.json(result);
  } catch (error: any) {
    console.error('Single blurb generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate blurbs' });
  }
});

// Update a single blurb text (manual edit)
router.patch('/options/:optionId/blurb', async (req, res) => {
  try {
    const optionId = parseInt(req.params.optionId);
    const { year, blurb } = req.body;

    if (!year || typeof blurb !== 'string') {
      res.status(400).json({ error: 'year and blurb are required' });
      return;
    }

    const [option] = await db.select()
      .from(roundOptions)
      .where(eq(roundOptions.id, optionId))
      .limit(1);

    if (!option) {
      res.status(404).json({ error: 'Round option not found' });
      return;
    }

    const existingBlurbs = (option.blurbs ?? {}) as Record<string, string>;
    const updatedBlurbs = { ...existingBlurbs, [String(year)]: blurb };

    await db.update(roundOptions)
      .set({ blurbs: updatedBlurbs })
      .where(eq(roundOptions.id, optionId));

    res.json({ blurbs: updatedBlurbs });
  } catch (error: any) {
    console.error('Blurb update error:', error);
    res.status(500).json({ error: error.message || 'Failed to update blurb' });
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

// Generate AI portraits for a challenge
router.post('/challenges/:id/portraits', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await generatePortraitsForChallenge(id);
    res.json(result);
  } catch (error) {
    console.error('Portrait generation error:', error);
    res.status(500).json({ error: 'Failed to generate portraits' });
  }
});

// Pre-seed community pick stats for a challenge
router.post('/challenges/:id/preseed', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await preseedStatsForChallenge(id);
    res.json(result);
  } catch (error) {
    console.error('Preseed error:', error);
    res.status(500).json({ error: 'Failed to preseed stats' });
  }
});

// Manually promote the next queued challenge
router.post('/promote-next', async (req, res) => {
  try {
    const result = await promoteNextChallenge();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to promote challenge' });
  }
});

// Debug: reset a user's session for a challenge (allows replaying)
router.delete('/challenges/:id/reset', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);
    const guestToken = req.headers['x-guest-token'] as string;

    if (!guestToken) {
      res.status(400).json({ error: 'x-guest-token header required' });
      return;
    }

    // Find and delete the session + its picks (cascade)
    const [session] = await db.select()
      .from(gameSessions)
      .where(and(
        eq(gameSessions.challengeId, challengeId),
        eq(gameSessions.guestToken, guestToken),
      ))
      .limit(1);

    if (!session) {
      res.json({ message: 'No session found', deleted: false });
      return;
    }

    // Delete picks first (FK constraint), then session
    await db.delete(userPicks).where(eq(userPicks.sessionId, session.id));
    await db.delete(gameSessions).where(eq(gameSessions.id, session.id));

    res.json({ message: 'Session reset', deleted: true, sessionId: session.id });
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ error: 'Failed to reset session' });
  }
});

// Temporary: upload portrait file (for migrating local portraits to Railway Volume)
router.post('/portraits/upload', express.raw({ type: 'image/png', limit: '5mb' }), (req: Request, res: Response) => {
  try {
    const playerId = req.query.playerId as string;
    if (!playerId || !/^[a-zA-Z0-9_.-]+$/.test(playerId)) {
      res.status(400).json({ error: 'Invalid playerId query param' });
      return;
    }

    const portraitDir = process.env.PORTRAIT_DIR
      || path.resolve(import.meta.dirname ?? process.cwd(), '../../frontend/public/portraits');

    if (!fs.existsSync(portraitDir)) {
      fs.mkdirSync(portraitDir, { recursive: true });
    }

    const filePath = path.join(portraitDir, `${playerId}.png`);
    fs.writeFileSync(filePath, req.body as Buffer);

    res.json({ ok: true, path: `/portraits/${playerId}.png` });
  } catch (error) {
    console.error('Portrait upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

export default router;
