import { Router } from 'express';
import { db } from '../db/index.js';
import { challenges, challengeRounds, roundOptions, gameSessions, userPicks, pickStats, players } from '../db/schema.js';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { calculateLegendScore } from '../services/legendScore.js';
import { calculatePerfectLineup, calculateSessionPercentile } from '../services/legendScore.js';
import { toNum } from '../lib/numeric.js';
import { getTodayET } from '../lib/date.js';

const router = Router();

// Helper to get or create guest token
function getGuestToken(req: any): string {
  return req.headers['x-guest-token'] as string || '';
}

// GET /api/challenge/today - Get today's active challenge + user's session
router.get('/today', async (req, res) => {
  try {
    const today = getTodayET();
    const guestToken = getGuestToken(req);

    // Find today's active challenge
    const [challenge] = await db.select()
      .from(challenges)
      .where(and(
        eq(challenges.challengeDate, today),
        eq(challenges.status, 'active')
      ))
      .limit(1);

    if (!challenge) {
      res.json({ challenge: null, session: null });
      return;
    }

    // Check if user has an existing session
    let session = null;
    if (guestToken) {
      const [existingSession] = await db.select()
        .from(gameSessions)
        .where(and(
          eq(gameSessions.challengeId, challenge.id),
          eq(gameSessions.guestToken, guestToken)
        ))
        .limit(1);

      if (existingSession) {
        if (existingSession.status === 'completed') {
          // Completed: return summary data for results redirect
          session = {
            id: existingSession.id,
            status: 'completed' as const,
            totalLegendScore: toNum(existingSession.totalLegendScore),
            percentile: toNum(existingSession.percentile, 50),
          };
        } else {
          // In-progress: client resumes from localStorage, just need session ID
          session = {
            id: existingSession.id,
            status: 'in_progress' as const,
          };
        }
      }
    }

    res.json({
      challenge: {
        id: challenge.id,
        date: challenge.challengeDate,
        positionOrder: challenge.positionOrder,
        theme: challenge.theme,
        totalRounds: 10,
      },
      session,
    });
  } catch (error) {
    console.error('Error fetching today\'s challenge:', error);
    res.status(500).json({ error: 'Failed to fetch challenge' });
  }
});

// POST /api/challenge/:id/start - Start game, return ALL round data upfront
router.post('/:id/start', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);
    const guestToken = getGuestToken(req);

    if (isNaN(challengeId)) {
      res.status(400).json({ error: 'Invalid challenge ID' });
      return;
    }

    if (!guestToken) {
      res.status(400).json({ error: 'Guest token required' });
      return;
    }

    // Check challenge exists and is active
    const [challenge] = await db.select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!challenge || challenge.status !== 'active') {
      res.status(404).json({ error: 'Challenge not found or not active' });
      return;
    }

    // Check for existing session (idempotent)
    let [session] = await db.select()
      .from(gameSessions)
      .where(and(
        eq(gameSessions.challengeId, challengeId),
        eq(gameSessions.guestToken, guestToken)
      ))
      .limit(1);

    if (session?.status === 'completed') {
      res.json({
        session: { id: session.id, status: 'completed' },
        challenge: { id: challenge.id, date: challenge.challengeDate, positionOrder: challenge.positionOrder, theme: challenge.theme, totalRounds: 10 },
        rounds: [],
        communityStats: [],
      });
      return;
    }

    if (!session) {
      try {
        [session] = await db.insert(gameSessions).values({
          challengeId,
          guestToken,
          status: 'in_progress',
          currentRound: 1,
        }).returning();
      } catch (insertErr: any) {
        // Race condition: concurrent request already created the session (unique constraint)
        if (insertErr?.code === '23505') {
          [session] = await db.select()
            .from(gameSessions)
            .where(and(
              eq(gameSessions.challengeId, challengeId),
              eq(gameSessions.guestToken, guestToken)
            ))
            .limit(1);
        } else {
          throw insertErr;
        }
      }
    }

    // Bulk-fetch all rounds + options + player records (3 queries instead of ~150)
    const { rounds, communityStats } = await getAllRoundData(challengeId);

    res.json({
      session: { id: session.id, status: 'in_progress' },
      challenge: { id: challenge.id, date: challenge.challengeDate, positionOrder: challenge.positionOrder, theme: challenge.theme, totalRounds: 10 },
      rounds,
      communityStats,
    });
  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({ error: 'Failed to start game' });
  }
});

// POST /api/challenge/:id/complete - Submit all picks at once, complete the game
router.post('/:id/complete', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);
    const guestToken = getGuestToken(req);
    const { sessionId, picks } = req.body as {
      sessionId: string;
      picks: Array<{ roundId: number; playerRecordId: number; year: number; wasTimeout: boolean }>;
    };

    if (isNaN(challengeId)) {
      res.status(400).json({ error: 'Invalid challenge ID' });
      return;
    }

    if (!sessionId || !Array.isArray(picks) || picks.length === 0) {
      res.status(400).json({ error: 'Missing sessionId or picks' });
      return;
    }

    // Validate session
    const [session] = await db.select()
      .from(gameSessions)
      .where(and(
        eq(gameSessions.id, sessionId),
        eq(gameSessions.guestToken, guestToken),
        eq(gameSessions.challengeId, challengeId)
      ))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Idempotent: if already completed, return existing results
    if (session.status === 'completed') {
      const existingPicks = await db.select({ legendScore: userPicks.legendScore })
        .from(userPicks)
        .where(eq(userPicks.sessionId, sessionId));

      const totalScore = existingPicks.reduce((sum, p) => sum + toNum(p.legendScore), 0);
      const roundedTotal = Math.round(totalScore * 10) / 10;
      const perfectLineup = await calculatePerfectLineup(challengeId);

      // Fresh community stats
      const roundIds = picks.map(p => p.roundId);
      const freshStats = await db.select().from(pickStats).where(inArray(pickStats.roundId, roundIds));
      const communityStats = buildCommunityStats(roundIds, freshStats);

      const [countResult] = await db.select({ count: sql<number>`count(*)` })
        .from(gameSessions)
        .where(and(eq(gameSessions.challengeId, challengeId), eq(gameSessions.status, 'completed')));

      res.json({
        totalLegendScore: toNum(session.totalLegendScore),
        percentile: toNum(session.percentile, 50),
        totalParticipants: toNum(countResult?.count),
        communityStats,
        perfectLineup,
      });
      return;
    }

    // Validate all roundIds belong to this challenge
    const challengeRoundsList = await db.select()
      .from(challengeRounds)
      .where(eq(challengeRounds.challengeId, challengeId));

    const validRoundIds = new Set(challengeRoundsList.map(r => r.id));
    for (const pick of picks) {
      if (!validRoundIds.has(pick.roundId)) {
        res.status(400).json({ error: `Round ${pick.roundId} does not belong to challenge ${challengeId}` });
        return;
      }
    }

    // Fetch all player records to re-compute Legend Scores server-side
    const playerRecordIds = picks.map(p => p.playerRecordId);
    const playerRecords = await db.select({
      id: players.id,
      zScorePosition: players.zScorePosition,
    })
      .from(players)
      .where(inArray(players.id, playerRecordIds));

    const playerScoreMap = new Map(
      playerRecords.map(r => [r.id, calculateLegendScore(toNum(r.zScorePosition))])
    );

    // Batch insert picks (onConflictDoNothing for idempotency)
    let totalScore = 0;
    for (const pick of picks) {
      const legendScore = playerScoreMap.get(pick.playerRecordId) ?? 0;
      totalScore += legendScore;

      await db.execute(sql`
        INSERT INTO user_picks (session_id, round_id, selected_player_id, selected_year, legend_score, was_timeout)
        VALUES (${sessionId}, ${pick.roundId}, ${pick.playerRecordId}, ${pick.year}, ${String(legendScore)}, ${pick.wasTimeout})
        ON CONFLICT (session_id, round_id) DO NOTHING
      `);
    }

    const roundedTotal = Math.round(totalScore * 10) / 10;

    // Batch update pick_stats
    for (const pick of picks) {
      await db.execute(sql`
        INSERT INTO pick_stats (round_id, player_id, selected_year, pick_count)
        VALUES (${pick.roundId}, ${pick.playerRecordId}, ${pick.year}, 1)
        ON CONFLICT (round_id, player_id, selected_year)
        DO UPDATE SET pick_count = pick_stats.pick_count + 1, updated_at = NOW()
      `);
    }

    // Calculate percentile
    const percentile = await calculateSessionPercentile(challengeId, roundedTotal);

    // Complete session
    await db.update(gameSessions)
      .set({
        currentRound: 11,
        status: 'completed',
        totalLegendScore: String(roundedTotal),
        percentile,
        completedAt: new Date(),
      })
      .where(eq(gameSessions.id, sessionId));

    // Perfect lineup
    const perfectLineup = await calculatePerfectLineup(challengeId);

    // Fresh community stats
    const roundIds = picks.map(p => p.roundId);
    const freshStats = await db.select().from(pickStats).where(inArray(pickStats.roundId, roundIds));
    const communityStats = buildCommunityStats(roundIds, freshStats);

    // Total participants
    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(gameSessions)
      .where(and(eq(gameSessions.challengeId, challengeId), eq(gameSessions.status, 'completed')));

    res.json({
      totalLegendScore: roundedTotal,
      percentile,
      totalParticipants: toNum(countResult?.count),
      communityStats,
      perfectLineup,
    });
  } catch (error) {
    console.error('Error completing game:', error);
    res.status(500).json({ error: 'Failed to complete game' });
  }
});

// GET /api/challenge/:id/results - Get completed game results
router.get('/:id/results', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);
    const guestToken = getGuestToken(req);

    if (isNaN(challengeId)) {
      res.status(400).json({ error: 'Invalid challenge ID' });
      return;
    }

    // Get session
    const [session] = await db.select()
      .from(gameSessions)
      .where(and(
        eq(gameSessions.challengeId, challengeId),
        eq(gameSessions.guestToken, guestToken),
        eq(gameSessions.status, 'completed')
      ))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: 'Completed session not found' });
      return;
    }

    // Get picks with full details
    const picks = await db.select({
      roundId: userPicks.roundId,
      roundNumber: challengeRounds.roundNumber,
      position: challengeRounds.position,
      playerName: sql<string>`${players.nameFirst} || ' ' || ${players.nameLast}`,
      year: userPicks.selectedYear,
      team: players.team,
      legendScore: userPicks.legendScore,
      stats: players.stats,
      wasTimeout: userPicks.wasTimeout,
    })
      .from(userPicks)
      .innerJoin(challengeRounds, eq(userPicks.roundId, challengeRounds.id))
      .innerJoin(players, eq(userPicks.selectedPlayerId, players.id))
      .where(eq(userPicks.sessionId, session.id))
      .orderBy(challengeRounds.roundNumber);

    // Get perfect lineup
    const perfectLineup = await calculatePerfectLineup(challengeId);

    // Count total participants
    const [countResult] = await db.select({
      count: sql<number>`count(*)`,
    })
      .from(gameSessions)
      .where(and(
        eq(gameSessions.challengeId, challengeId),
        eq(gameSessions.status, 'completed')
      ));

    // Community stats for all rounds
    const roundIds = picks.map(p => p.roundId);
    let communityStats: ReturnType<typeof buildCommunityStats> = [];
    if (roundIds.length > 0) {
      const allStats = await db.select().from(pickStats).where(inArray(pickStats.roundId, roundIds));
      communityStats = buildCommunityStats(roundIds, allStats);
    }

    res.json({
      session: {
        totalLegendScore: toNum(session.totalLegendScore),
        percentile: toNum(session.percentile, 50),
        completedAt: session.completedAt,
      },
      picks: picks.map(p => ({ ...p, legendScore: toNum(p.legendScore) })),
      perfectLineup,
      totalParticipants: toNum(countResult?.count),
      communityStats,
    });
  } catch (error) {
    console.error('Error fetching results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Helper: bulk-fetch ALL round data for a challenge (3 queries instead of ~150)
export async function getAllRoundData(challengeId: number) {
  // 1. All rounds
  const rounds = await db.select()
    .from(challengeRounds)
    .where(eq(challengeRounds.challengeId, challengeId))
    .orderBy(challengeRounds.roundNumber);

  if (rounds.length === 0) return { rounds: [], communityStats: [] };

  const roundIds = rounds.map(r => r.id);

  // 2. All options for all rounds
  const allOptions = await db.select()
    .from(roundOptions)
    .where(inArray(roundOptions.roundId, roundIds))
    .orderBy(roundOptions.roundId, roundOptions.playerSlot);

  // 3. Collect all (playerId, year) pairs and batch-fetch player records
  const playerYearPairs: Array<{ playerId: string; year: number }> = [];
  for (const opt of allOptions) {
    const years = opt.yearOptions as number[];
    for (const year of years) {
      playerYearPairs.push({ playerId: opt.playerId, year });
    }
  }

  let playerMap = new Map<string, {
    id: number;
    zScorePosition: string;
    stats: unknown;
    categoryZscores: unknown;
    playerType: string;
    team: string | null;
    nameFirst: string | null;
    nameLast: string | null;
  }>();

  if (playerYearPairs.length > 0) {
    const whereClauses = playerYearPairs.map(
      p => sql`(${players.playerId} = ${p.playerId} AND ${players.year} = ${p.year})`
    );
    const combined = sql.join(whereClauses, sql` OR `);

    const playerRecords = await db.select({
      id: players.id,
      playerId: players.playerId,
      year: players.year,
      zScorePosition: players.zScorePosition,
      stats: players.stats,
      categoryZscores: players.categoryZscores,
      playerType: players.playerType,
      team: players.team,
      nameFirst: players.nameFirst,
      nameLast: players.nameLast,
    })
      .from(players)
      .where(combined);

    playerMap = new Map(
      playerRecords.map(r => [`${r.playerId}-${r.year}`, r])
    );
  }

  // 4. Snapshot community pick stats for all rounds
  const allStats = await db.select()
    .from(pickStats)
    .where(inArray(pickStats.roundId, roundIds));

  const communityStats = roundIds.map(roundId => {
    const roundStatEntries = allStats.filter(s => s.roundId === roundId);
    const total = roundStatEntries.reduce((sum, s) => sum + s.pickCount, 0);
    return {
      roundId,
      picks: roundStatEntries.map(s => ({
        playerId: s.playerId,
        year: s.selectedYear,
        percentage: total > 0 ? Math.round((s.pickCount / total) * 100) : 0,
      })),
    };
  });

  // 5. Assemble enriched rounds
  const enrichedRounds = rounds.map(round => {
    const opts = allOptions.filter(o => o.roundId === round.id);
    return {
      roundId: round.id,
      roundNumber: round.roundNumber,
      position: round.position,
      players: opts.map(opt => {
        const years = opt.yearOptions as number[];
        return {
          slot: opt.playerSlot,
          name: opt.playerName,
          playerId: opt.playerId,
          portraitUrl: opt.portraitUrl,
          yearOptions: years.map(year => {
            const record = playerMap.get(`${opt.playerId}-${year}`);
            if (!record) {
              console.warn(`Missing player record for playerId=${opt.playerId} year=${year}`);
            }
            return {
              year,
              playerRecordId: record?.id ?? 0,
              zScorePosition: toNum(record?.zScorePosition),
              team: record?.team ?? '',
              stats: (record?.stats ?? {}) as Record<string, number>,
              categoryZscores: (record?.categoryZscores ?? {}) as Record<string, number>,
              playerType: (record?.playerType ?? 'batter') as 'batter' | 'pitcher',
            };
          }),
          blurbs: (opt.blurbs ?? {}) as Record<string, string>,
        };
      }),
      timeLimit: 30,
    };
  });

  return { rounds: enrichedRounds, communityStats };
}

// Helper: build community stats from raw pick_stats rows
function buildCommunityStats(roundIds: number[], allStats: Array<{ roundId: number; playerId: number; selectedYear: number; pickCount: number }>) {
  return roundIds.map(roundId => {
    const entries = allStats.filter(s => s.roundId === roundId);
    const total = entries.reduce((sum, s) => sum + s.pickCount, 0);
    return {
      roundId,
      picks: entries.map(s => ({
        playerId: s.playerId,
        year: s.selectedYear,
        percentage: total > 0 ? Math.round((s.pickCount / total) * 100) : 0,
      })),
    };
  });
}

export default router;
