import { Router } from 'express';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { db } from '../db/index.js';
import { challenges, challengeRounds, roundOptions, gameSessions, userPicks, players, pickStats, portraits } from '../db/schema.js';
import { eq, and, desc, inArray, sql, asc } from 'drizzle-orm';
import { generateBatch, queueChallenges, generateThemedBatch } from '../services/challengeGenerator.js';
import { generateBlurbsForChallenge, generateBlurbsForOption } from '../services/challengeBlurbs.js';
import { generatePortraitsForChallenge, generatePortraitForOption, getPortraitPath, auditPortrait, POSITION_LABELS } from '../services/portraitGenerator.js';
import { preseedStatsForChallenge } from '../services/statsPreseeder.js';
import { promoteNextChallenge } from '../services/dailyScheduler.js';
import { runAgentBuilder } from '../services/agentChallengeBuilder.js';
import { calculateSandlotScore } from '../services/sandlotScore.js';
import { toNum } from '../lib/numeric.js';
import { asyncPool } from '../lib/asyncPool.js';
import { getTeamName } from '../lib/teams.js';
import { getTodayET } from '../lib/date.js';
import { getAllRoundData } from './challenge.js';

const router = Router();

// In-memory enrichment progress tracker
const enrichmentProgress = new Map<number, { phase: 'blurbs' | 'portraits' | 'preseed'; startedAt: number }>();

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

// Background enrichment pipeline: blurbs → portraits → preseed for each challenge.
// Fire-and-forget — logs progress to console, never throws.
function enrichChallengesInBackground(challengeIds: number[]) {
  (async () => {
    for (let i = 0; i < challengeIds.length; i++) {
      const id = challengeIds[i];
      const label = `[enrich ${i + 1}/${challengeIds.length}] Challenge ${id}`;
      try {
        enrichmentProgress.set(id, { phase: 'blurbs', startedAt: Date.now() });
        console.log(`${label}: generating blurbs...`);
        await generateBlurbsForChallenge(id);

        enrichmentProgress.set(id, { phase: 'portraits', startedAt: Date.now() });
        console.log(`${label}: generating portraits...`);
        await generatePortraitsForChallenge(id);

        enrichmentProgress.set(id, { phase: 'preseed', startedAt: Date.now() });
        console.log(`${label}: preseeding stats...`);
        await preseedStatsForChallenge(id);

        console.log(`${label}: done`);
      } catch (err) {
        console.error(`${label}: pipeline error:`, err);
      } finally {
        enrichmentProgress.delete(id);
      }
    }
    console.log(`Enrichment complete for ${challengeIds.length} challenges`);
  })();
}

// Generate a new challenge
router.post('/challenges/generate', async (req, res) => {
  try {
    const { count = 1, theme, positionOrder, date } = req.body;
    const ids = await generateBatch(count, { theme, positionOrder, date });
    res.json({ challengeIds: ids, count: ids.length });
    enrichChallengesInBackground(ids);
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
    enrichChallengesInBackground(result.challengeIds);
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
      .set({ status: 'draft', publishedAt: null, queuePosition: null })
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

// Reorder the queue — receives ordered array of challenge IDs
router.post('/challenges/reorder', async (req, res) => {
  try {
    const { challengeIds } = req.body as { challengeIds: number[] };
    if (!Array.isArray(challengeIds) || challengeIds.length === 0) {
      res.status(400).json({ error: 'challengeIds array required' });
      return;
    }

    // Update each challenge's queuePosition to match the new order
    for (let i = 0; i < challengeIds.length; i++) {
      await db.update(challenges)
        .set({ queuePosition: i + 1 })
        .where(and(
          eq(challenges.id, challengeIds[i]),
          eq(challenges.status, 'scheduled'),
        ));
    }

    res.json({ reordered: challengeIds.length });
  } catch (error) {
    console.error('Reorder error:', error);
    res.status(500).json({ error: 'Failed to reorder queue' });
  }
});

// AI agent challenge builder — SSE stream (must be before :id routes)
router.post('/challenges/generate-agent', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'prompt string required' });
    return;
  }

  console.log(JSON.stringify({ event: 'agent_request', route: 'generate-agent', promptLength: prompt.length }));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const challengeId = await runAgentBuilder(prompt, res);
    if (challengeId) {
      enrichChallengesInBackground([challengeId]);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'agent_request_error', route: 'generate-agent', error: String(error) }));
    res.write(`data: ${JSON.stringify({ type: 'error', message: String(error) })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    res.end();
  }
});

// AI agent builder — continue conversation (must be before :id routes)
router.post('/challenges/generate-agent/continue', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId string required' });
    return;
  }
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message string required' });
    return;
  }

  console.log(JSON.stringify({ event: 'agent_request', route: 'generate-agent/continue', sessionId, messageLength: message.length }));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const challengeId = await runAgentBuilder(message, res, sessionId);
    if (challengeId) {
      enrichChallengesInBackground([challengeId]);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'agent_request_error', route: 'generate-agent/continue', sessionId, error: String(error) }));
    res.write(`data: ${JSON.stringify({ type: 'error', message: String(error) })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    res.end();
  }
});

// Bake all incomplete queued challenges — SSE progress stream (must be before :id routes)
router.post('/challenges/bake-all', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // Find all queued (scheduled) challenges
    const queued = await db.select()
      .from(challenges)
      .where(eq(challenges.status, 'scheduled'))
      .orderBy(sql`${challenges.queuePosition} ASC NULLS LAST`, asc(challenges.id));

    // Check which are incomplete
    const incomplete: typeof queued = [];
    for (const c of queued) {
      const rounds = await db.select({ id: challengeRounds.id })
        .from(challengeRounds)
        .where(eq(challengeRounds.challengeId, c.id));
      const roundIds = rounds.map(r => r.id);
      if (roundIds.length === 0) { incomplete.push(c); continue; }

      const options = await db.select({
        portraitUrl: roundOptions.portraitUrl,
        blurbs: roundOptions.blurbs,
        yearOptions: roundOptions.yearOptions,
      }).from(roundOptions).where(inArray(roundOptions.roundId, roundIds));

      let isComplete = rounds.length === 10 && options.length === 30;
      if (isComplete) {
        for (const opt of options) {
          if (!opt.portraitUrl) { isComplete = false; break; }
          const blurbs = (opt.blurbs ?? {}) as Record<string, string>;
          for (const year of (opt.yearOptions as number[])) {
            if (!blurbs[String(year)]?.trim()) { isComplete = false; break; }
          }
          if (!isComplete) break;
        }
      }
      if (!isComplete) incomplete.push(c);
    }

    res.write(`data: ${JSON.stringify({ type: 'start', total: incomplete.length })}\n\n`);

    for (let i = 0; i < incomplete.length; i++) {
      const c = incomplete[i];
      res.write(`data: ${JSON.stringify({ type: 'progress', index: i, challengeId: c.id, theme: c.theme })}\n\n`);
      try {
        const blurbResult = await generateBlurbsForChallenge(c.id);
        const portraitResult = await generatePortraitsForChallenge(c.id);
        await preseedStatsForChallenge(c.id);
        res.write(`data: ${JSON.stringify({ type: 'done', index: i, challengeId: c.id, blurbs: blurbResult, portraits: portraitResult })}\n\n`);
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', index: i, challengeId: c.id, error: String(err) })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'complete', processed: incomplete.length })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`);
    res.end();
  }
});

// Live stats for today's active challenge
router.get('/stats/today', async (req, res) => {
  try {
    const [active] = await db.select()
      .from(challenges)
      .where(eq(challenges.status, 'active'))
      .limit(1);

    if (!active) {
      res.json({ active: false });
      return;
    }

    const sessions = await db.select({
      status: gameSessions.status,
      totalLegendScore: gameSessions.totalLegendScore,
    })
      .from(gameSessions)
      .where(eq(gameSessions.challengeId, active.id));

    const started = sessions.length;
    const completed = sessions.filter(s => s.status === 'completed').length;
    const completedScores = sessions
      .filter(s => s.status === 'completed' && s.totalLegendScore != null)
      .map(s => Number(s.totalLegendScore));
    const avgScore = completedScores.length > 0
      ? completedScores.reduce((a, b) => a + b, 0) / completedScores.length
      : 0;

    // Score distribution (50 buckets of 2: 0-2, 2-4, ..., 98-100)
    const distribution = Array(50).fill(0) as number[];
    for (const score of completedScores) {
      const bucket = Math.min(49, Math.floor(score / 2));
      distribution[bucket]++;
    }

    // Per-round most-picked player
    const rounds = await db.select()
      .from(challengeRounds)
      .where(eq(challengeRounds.challengeId, active.id))
      .orderBy(asc(challengeRounds.roundNumber));

    const roundIds = rounds.map(r => r.id);
    interface MostPickedPlayer {
      playerName: string;
      pickCount: number;
      portraitUrl: string | null;
      selectedYear: number;
      team: string | null;
    }
    let roundStats: Array<{
      roundNumber: number;
      position: string;
      mostPicked: MostPickedPlayer | null;
    }> = [];

    if (roundIds.length > 0) {
      const allPickStats = await db.select({
        roundId: pickStats.roundId,
        playerId: pickStats.playerId, // integer references players.id
        selectedYear: pickStats.selectedYear,
        pickCount: pickStats.pickCount,
      }).from(pickStats).where(inArray(pickStats.roundId, roundIds));

      const allOptions = await db.select({
        roundId: roundOptions.roundId,
        playerId: roundOptions.playerId, // varchar Lahman player_id
        playerName: roundOptions.playerName,
        portraitUrl: roundOptions.portraitUrl,
      }).from(roundOptions).where(inArray(roundOptions.roundId, roundIds));

      // Build lookups from numeric players.id → Lahman playerId + team
      const numericIds = [...new Set(allPickStats.map(s => s.playerId))];
      const playerIdMapping = new Map<number, { lahmanId: string; team: string | null }>();
      if (numericIds.length > 0) {
        const playerRows = await db.select({ id: players.id, playerId: players.playerId, team: players.team })
          .from(players)
          .where(inArray(players.id, numericIds));
        for (const row of playerRows) {
          playerIdMapping.set(row.id, { lahmanId: row.playerId, team: row.team });
        }
      }

      // Map roundId + Lahman playerId → option info
      const optionInfoMap = new Map<string, { name: string; portraitUrl: string | null }>();
      for (const opt of allOptions) {
        optionInfoMap.set(`${opt.roundId}-${opt.playerId}`, {
          name: opt.playerName,
          portraitUrl: opt.portraitUrl,
        });
      }

      roundStats = rounds.map(round => {
        // Find the single most-picked player-year combo (no aggregation across years)
        const stats = allPickStats.filter(s => s.roundId === round.id);
        let mostPicked: MostPickedPlayer | null = null;
        for (const s of stats) {
          if (!mostPicked || s.pickCount > mostPicked.pickCount) {
            const mapping = playerIdMapping.get(s.playerId);
            const lahmanId = mapping?.lahmanId ?? String(s.playerId);
            const info = optionInfoMap.get(`${round.id}-${lahmanId}`);
            mostPicked = {
              playerName: info?.name || lahmanId,
              pickCount: s.pickCount,
              portraitUrl: info?.portraitUrl ?? null,
              selectedYear: s.selectedYear,
              team: mapping?.team ?? null,
            };
          }
        }
        return { roundNumber: round.roundNumber, position: round.position, mostPicked };
      });
    }

    res.json({
      active: true,
      challengeId: active.id,
      theme: active.theme,
      sessions: { started, completed, completionRate: started > 0 ? completed / started : 0 },
      avgScore: Math.round(avgScore * 10) / 10,
      scoreDistribution: distribution,
      roundStats,
    });
  } catch (error) {
    console.error('Today stats error:', error);
    res.status(500).json({ error: 'Failed to fetch today stats' });
  }
});

// Historical daily stats
router.get('/stats/history', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 180);

    const completedChallenges = await db.select({
      id: challenges.id,
      challengeDate: challenges.challengeDate,
      theme: challenges.theme,
    })
      .from(challenges)
      .where(eq(challenges.status, 'completed'))
      .orderBy(desc(challenges.challengeDate));

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const recentChallenges = completedChallenges.filter(c =>
      c.challengeDate && c.challengeDate >= cutoffStr
    ).slice(0, days);

    const dailyStats = await Promise.all(recentChallenges.map(async (ch) => {
      const sessions = await db.select({
        status: gameSessions.status,
        totalLegendScore: gameSessions.totalLegendScore,
        guestToken: gameSessions.guestToken,
      })
        .from(gameSessions)
        .where(eq(gameSessions.challengeId, ch.id));

      const completions = sessions.filter(s => s.status === 'completed').length;
      const uniqueUsers = new Set(sessions.map(s => s.guestToken)).size;
      const scores = sessions
        .filter(s => s.status === 'completed' && s.totalLegendScore != null)
        .map(s => Number(s.totalLegendScore));
      const avgScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;

      return {
        date: ch.challengeDate,
        challengeId: ch.id,
        theme: ch.theme,
        completions,
        uniqueUsers,
        avgScore: Math.round(avgScore * 10) / 10,
      };
    }));

    res.json({ days, stats: dailyStats });
  } catch (error) {
    console.error('History stats error:', error);
    res.status(500).json({ error: 'Failed to fetch history stats' });
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
        enrichmentPhase: enrichmentProgress.get(challenge.id)?.phase ?? null,
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

// Get challenge details (enriched with z-scores for Sandlot Score display)
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
    const teamMap = new Map<string, string>();
    if (playerYearPairs.length > 0) {
      const whereClauses = playerYearPairs.map(
        p => sql`(${players.playerId} = ${p.playerId} AND ${players.year} = ${p.year})`
      );
      const combined = sql.join(whereClauses, sql` OR `);
      const records = await db.select({
        playerId: players.playerId,
        year: players.year,
        zScorePosition: players.zScorePosition,
        team: players.team,
      }).from(players).where(combined);

      for (const r of records) {
        zScoreMap.set(`${r.playerId}-${r.year}`, toNum(r.zScorePosition));
        teamMap.set(`${r.playerId}-${r.year}`, r.team ?? '');
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
          legendScore: calculateSandlotScore(zScoreMap.get(`${opt.playerId}-${year}`) ?? 0),
          team: teamMap.get(`${opt.playerId}-${year}`) ?? '',
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

    // Compute Sandlot Score range
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
        const ls = calculateSandlotScore(toNum(r.zScorePosition));
        if (minLegendScore === null || ls < minLegendScore) minLegendScore = ls;
        if (maxLegendScore === null || ls > maxLegendScore) maxLegendScore = ls;
      }
    }

    // Count completed drafts (preseed vs real)
    const [draftCounts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        preseed: sql<number>`count(*) filter (where ${gameSessions.guestToken} like 'preseed-%')::int`,
      })
      .from(gameSessions)
      .where(and(
        eq(gameSessions.challengeId, id),
        eq(gameSessions.status, 'completed'),
      ));
    const draftsTotal = draftCounts?.total ?? 0;
    const draftsPreseed = draftCounts?.preseed ?? 0;
    const draftsReal = draftsTotal - draftsPreseed;

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
      drafts: { total: draftsTotal, preseed: draftsPreseed, real: draftsReal },
      draftsReady: draftsPreseed > 0,
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

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['scheduled'],
  scheduled: ['active', 'draft'],
  active: ['completed', 'draft'],
  completed: ['draft'],
};

// Update challenge
router.patch('/challenges/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, theme, challengeDate, positionOrder } = req.body;

    // Fetch current challenge
    const [current] = await db.select().from(challenges).where(eq(challenges.id, id)).limit(1);
    if (!current) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }

    // Validate status transition
    if (status && status !== current.status) {
      const allowed = VALID_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(status)) {
        res.status(400).json({
          error: `Invalid status transition: ${current.status} → ${status}. Allowed: ${allowed.join(', ') || 'none'}`,
        });
        return;
      }
      // Require challengeDate for draft → scheduled
      if (current.status === 'draft' && status === 'scheduled' && !challengeDate && !current.challengeDate) {
        res.status(400).json({ error: 'challengeDate is required when scheduling a challenge' });
        return;
      }
    }

    // Prevent duplicate dates
    if (challengeDate) {
      const [existing] = await db.select({ id: challenges.id })
        .from(challenges)
        .where(and(
          eq(challenges.challengeDate, challengeDate),
          sql`${challenges.id} != ${id}`,
        ))
        .limit(1);
      if (existing) {
        res.status(400).json({ error: `Another challenge (#${existing.id}) already has date ${challengeDate}` });
        return;
      }
    }

    const updates: Record<string, any> = {};
    if (status) updates.status = status;
    if (theme !== undefined) updates.theme = theme;
    if (challengeDate) updates.challengeDate = challengeDate;
    if (positionOrder) updates.positionOrder = positionOrder;

    const [updated] = await db.update(challenges)
      .set(updates)
      .where(eq(challenges.id, id))
      .returning();

    res.json({ challenge: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update challenge' });
  }
});

// Delete challenge
router.delete('/challenges/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    // Get round IDs for this challenge (needed to clean up FKs without cascade)
    const rounds = await db.select({ id: challengeRounds.id })
      .from(challengeRounds)
      .where(eq(challengeRounds.challengeId, id));
    const roundIds = rounds.map(r => r.id);

    if (roundIds.length > 0) {
      // Delete pickStats and userPicks that reference these rounds
      await db.delete(pickStats).where(inArray(pickStats.roundId, roundIds));
      await db.delete(userPicks).where(inArray(userPicks.roundId, roundIds));
    }

    // Delete game sessions for this challenge
    await db.delete(gameSessions).where(eq(gameSessions.challengeId, id));

    // Now delete the challenge (cascades to challengeRounds → roundOptions)
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

// Bake a single challenge: blurbs + portraits + preseed
router.post('/challenges/:id/bake', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const blurbResult = await generateBlurbsForChallenge(id);
    const portraitResult = await generatePortraitsForChallenge(id);
    const preseedResult = await preseedStatsForChallenge(id);
    res.json({ blurbs: blurbResult, portraits: portraitResult, preseed: preseedResult });
  } catch (error) {
    console.error('Bake error:', error);
    res.status(500).json({ error: 'Failed to bake challenge' });
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
    const count = req.body?.count ? parseInt(req.body.count) : undefined;
    const result = await preseedStatsForChallenge(id, count);
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

// Force-activate a specific challenge (deactivates the current active one)
router.post('/challenges/:id/activate', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid challenge ID' });
      return;
    }

    const todayStr = getTodayET();

    // Verify the target challenge exists
    const [target] = await db.select()
      .from(challenges)
      .where(eq(challenges.id, id))
      .limit(1);

    if (!target) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }

    if (target.status === 'active') {
      res.json({ activated: id, deactivated: null, message: 'Already active' });
      return;
    }

    // Deactivate any currently active challenge (move it back to completed)
    const deactivated = await db.update(challenges)
      .set({ status: 'completed' })
      .where(eq(challenges.status, 'active'))
      .returning();

    // Swap dates to avoid unique constraint violations on challengeDate.
    // 1. Move target to a temp placeholder
    const oldDate = target.challengeDate;
    const tempDate = `activating-${id}`;
    await db.update(challenges)
      .set({ challengeDate: tempDate })
      .where(eq(challenges.id, id));

    // 2. Give today's date holder (if any) the target's old date
    await db.update(challenges)
      .set({ challengeDate: oldDate })
      .where(sql`${challenges.challengeDate} = ${todayStr} AND ${challenges.id} != ${id}`);

    // 3. Assign today's date to the target
    await db.update(challenges)
      .set({
        status: 'active',
        challengeDate: todayStr,
        queuePosition: null,
      })
      .where(eq(challenges.id, id));

    res.json({
      activated: id,
      deactivated: deactivated.length > 0 ? deactivated[0].id : null,
    });
  } catch (error) {
    console.error('Force activate error:', error);
    res.status(500).json({ error: 'Failed to activate challenge' });
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

// Audit portrait quality — validates portraits against player appearance
router.post('/portraits/audit', async (req, res) => {
  try {
    const { challengeIds } = req.body as { challengeIds?: number[] };

    // Default: audit active + upcoming (scheduled) challenges
    let targetChallengeIds: number[];
    if (challengeIds && challengeIds.length > 0) {
      targetChallengeIds = challengeIds;
    } else {
      const active = await db.select({ id: challenges.id })
        .from(challenges)
        .where(inArray(challenges.status, ['active', 'scheduled']));
      targetChallengeIds = active.map(c => c.id);
    }

    if (targetChallengeIds.length === 0) {
      res.json({ total: 0, skipped: 0, failed: 0, passed: 0, results: [] });
      return;
    }

    // Get all round options for target challenges
    const rounds = await db.select({ id: challengeRounds.id, challengeId: challengeRounds.challengeId, position: challengeRounds.position })
      .from(challengeRounds)
      .where(inArray(challengeRounds.challengeId, targetChallengeIds));

    const roundIds = rounds.map(r => r.id);
    if (roundIds.length === 0) {
      res.json({ total: 0, skipped: 0, failed: 0, passed: 0, results: [] });
      return;
    }

    const options = await db.select()
      .from(roundOptions)
      .where(inArray(roundOptions.roundId, roundIds));

    const roundMap = new Map(rounds.map(r => [r.id, r]));

    // Check which portraits are already validated
    const existingPortraits = await db.select()
      .from(portraits)
      .where(eq(portraits.validated, true));
    const validatedSet = new Set(existingPortraits.map(p => p.playerId));

    // Deduplicate by playerId (same portrait file shared across challenges)
    const seenPlayerIds = new Set<string>();
    interface AuditTask {
      optionId: number;
      playerId: string;
      playerName: string;
      challengeId: number;
      teamName: string;
      year: number;
      position: string;
    }
    const tasks: AuditTask[] = [];
    let skipped = 0;

    for (const opt of options) {
      if (seenPlayerIds.has(opt.playerId)) { skipped++; continue; }
      seenPlayerIds.add(opt.playerId);

      if (validatedSet.has(opt.playerId)) { skipped++; continue; }
      if (!fs.existsSync(getPortraitPath(opt.playerId))) { skipped++; continue; }

      const round = roundMap.get(opt.roundId);
      const challengeId = round?.challengeId ?? 0;

      // Pick best year for audit context
      const years = opt.yearOptions as number[];
      let bestTeam = 'Unknown';
      let bestYear = years[0] ?? 2000;
      let bestZ = -Infinity;
      let bestPosition = round?.position ?? 'player';

      for (const year of years) {
        const [record] = await db.select({
          team: players.team,
          zScorePosition: players.zScorePosition,
          primaryPosition: players.primaryPosition,
        })
          .from(players)
          .where(and(eq(players.playerId, opt.playerId), eq(players.year, year)))
          .limit(1);

        if (record) {
          const z = Number(record.zScorePosition);
          if (z > bestZ) {
            bestZ = z;
            bestTeam = record.team ?? 'Unknown';
            bestYear = year;
            bestPosition = record.primaryPosition;
          }
        }
      }

      tasks.push({
        optionId: opt.id,
        playerId: opt.playerId,
        playerName: opt.playerName,
        challengeId,
        teamName: getTeamName(bestTeam),
        year: bestYear,
        position: POSITION_LABELS[bestPosition] ?? bestPosition,
      });
    }

    console.log(`  Auditing ${tasks.length} portraits (${skipped} skipped)...`);

    const results: Array<{
      optionId: number;
      playerId: string;
      playerName: string;
      challengeId: number;
      pass: boolean;
      reason: string;
    }> = [];

    await asyncPool(
      tasks,
      5,
      async (task) => {
        const result = await auditPortrait(
          task.playerId, task.playerName, task.teamName, task.year, task.position,
        );

        // Mark validated if passed
        if (result.pass) {
          await db.insert(portraits)
            .values({ playerId: task.playerId, validated: true, validatedAt: new Date(), portraitUrl: `/portraits/${task.playerId}.webp` })
            .onConflictDoUpdate({
              target: portraits.playerId,
              set: { validated: true, validatedAt: new Date() },
            });
        }

        results.push({
          optionId: task.optionId,
          playerId: task.playerId,
          playerName: task.playerName,
          challengeId: task.challengeId,
          pass: result.pass,
          reason: result.reason,
        });

        console.log(`    ${result.pass ? '✓' : '✗'} ${task.playerName}: ${result.reason}`);
        return task.playerId;
      },
      { retries: 1, backoffMs: 3000 },
    );

    // Sort: failures first
    results.sort((a, b) => (a.pass === b.pass ? 0 : a.pass ? 1 : -1));

    const failed = results.filter(r => !r.pass).length;
    const passed = results.filter(r => r.pass).length;

    res.json({ total: results.length, skipped, failed, passed, results });
  } catch (error) {
    console.error('Portrait audit error:', error);
    res.status(500).json({ error: 'Failed to audit portraits' });
  }
});

// Regenerate portraits by optionId with full quality validation
router.post('/portraits/regenerate', async (req, res) => {
  try {
    const { optionIds } = req.body as { optionIds: number[] };
    if (!Array.isArray(optionIds) || optionIds.length === 0) {
      res.status(400).json({ error: 'optionIds array required' });
      return;
    }

    const results: Array<{
      optionId: number;
      playerName: string;
      pass: boolean;
      attempts: number;
      error?: string;
    }> = [];

    const { failures } = await asyncPool(
      optionIds,
      3,
      async (optionId) => {
        const result = await generatePortraitForOption(optionId);
        const [opt] = await db.select({ playerName: roundOptions.playerName })
          .from(roundOptions)
          .where(eq(roundOptions.id, optionId))
          .limit(1);
        results.push({
          optionId,
          playerName: opt?.playerName ?? 'Unknown',
          pass: result.pass,
          attempts: result.attempts,
        });
        return optionId;
      },
      { retries: 1, backoffMs: 3000 },
    );

    for (const f of failures) {
      results.push({
        optionId: f.item,
        playerName: 'Unknown',
        pass: false,
        attempts: 0,
        error: f.error.message,
      });
    }

    res.json({
      regenerated: optionIds.length - failures.length,
      failed: failures.length,
      results,
    });
  } catch (error) {
    console.error('Regenerate portraits error:', error);
    res.status(500).json({ error: 'Failed to regenerate portraits' });
  }
});

export default router;
