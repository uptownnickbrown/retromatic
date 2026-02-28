import { Router } from 'express';
import { db } from '../db/index.js';
import { challenges, challengeRounds, roundOptions, gameSessions, userPicks, pickStats, players } from '../db/schema.js';
import { eq, and, sql, desc, asc, inArray } from 'drizzle-orm';
import { calculateSandlotScore } from '../services/sandlotScore.js';
import { calculatePerfectLineup, calculateSessionPercentile } from '../services/sandlotScore.js';
import { toNum } from '../lib/numeric.js';
import { getTodayET } from '../lib/date.js';

const router = Router();

// Helper to get or create guest token
function getGuestToken(req: any): string {
  return req.headers['x-guest-token'] as string || '';
}

// GET /api/challenge/home - Bundled home page data (today + session + yesterday + tomorrow)
router.get('/home', async (req, res) => {
  try {
    const guestToken = getGuestToken(req);

    // Today's active challenge
    const [todayChallenge] = await db.select()
      .from(challenges)
      .where(eq(challenges.status, 'active'))
      .limit(1);

    let today = null;
    let session = null;

    if (todayChallenge) {
      today = {
        id: todayChallenge.id,
        date: todayChallenge.challengeDate,
        theme: todayChallenge.theme,
        totalRounds: 10,
      };

      // Session lookup (same logic as /today)
      if (guestToken) {
        const [existingSession] = await db.select()
          .from(gameSessions)
          .where(and(
            eq(gameSessions.challengeId, todayChallenge.id),
            eq(gameSessions.guestToken, guestToken)
          ))
          .limit(1);

        if (existingSession) {
          if (existingSession.status === 'completed') {
            session = {
              id: existingSession.id,
              status: 'completed' as const,
              totalLegendScore: toNum(existingSession.totalLegendScore),
              percentile: toNum(existingSession.percentile, 50),
            };
          } else {
            session = {
              id: existingSession.id,
              status: 'in_progress' as const,
            };
          }
        }
      }
    }

    // Past challenges: up to 7 most recent completed
    const pastChallenges = await db.select({
      id: challenges.id,
      date: challenges.challengeDate,
      theme: challenges.theme,
    })
      .from(challenges)
      .where(eq(challenges.status, 'completed'))
      .orderBy(desc(challenges.challengeDate))
      .limit(7);

    // Tomorrow: next scheduled challenge (by queue position, then id)
    const [tomorrowChallenge] = await db.select({
      theme: challenges.theme,
    })
      .from(challenges)
      .where(eq(challenges.status, 'scheduled'))
      .orderBy(
        sql`${challenges.queuePosition} ASC NULLS LAST`,
        asc(challenges.id),
      )
      .limit(1);

    res.json({
      today,
      session,
      pastChallenges: pastChallenges.map(c => ({
        id: c.id,
        date: c.date,
        theme: c.theme,
      })),
      tomorrow: tomorrowChallenge ? {
        theme: tomorrowChallenge.theme,
      } : null,
    });
  } catch (error) {
    console.error('Error fetching home data:', error);
    res.status(500).json({ error: 'Failed to fetch home data' });
  }
});

// GET /api/challenge/today - Get today's active challenge + user's session
router.get('/today', async (req, res) => {
  try {
    const guestToken = getGuestToken(req);

    // Find the currently active challenge (auto-promoted at midnight)
    const [challenge] = await db.select()
      .from(challenges)
      .where(eq(challenges.status, 'active'))
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

    // Fetch all player records to re-compute Sandlot Scores server-side
    const playerRecordIds = picks.map(p => p.playerRecordId);
    const playerRecords = await db.select({
      id: players.id,
      zScorePosition: players.zScorePosition,
    })
      .from(players)
      .where(inArray(players.id, playerRecordIds));

    const playerScoreMap = new Map(
      playerRecords.map(r => [r.id, calculateSandlotScore(toNum(r.zScorePosition))])
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

    // Step 1: Mark session completed with score (so percentile query includes this session)
    await db.update(gameSessions)
      .set({
        currentRound: 11,
        status: 'completed',
        totalLegendScore: String(roundedTotal),
        completedAt: new Date(),
      })
      .where(eq(gameSessions.id, sessionId));

    // Step 2: Calculate percentile (now includes this session in the query)
    const percentile = await calculateSessionPercentile(challengeId, roundedTotal);

    // Step 3: Store the percentile
    await db.update(gameSessions)
      .set({ percentile })
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

    // Get picks with full details including portrait, blurb, category z-scores
    const picks = await db.select({
      roundId: userPicks.roundId,
      roundNumber: challengeRounds.roundNumber,
      position: challengeRounds.position,
      playerName: sql<string>`${players.nameFirst} || ' ' || ${players.nameLast}`,
      year: userPicks.selectedYear,
      team: players.team,
      legendScore: userPicks.legendScore,
      stats: players.stats,
      categoryZscores: players.categoryZscores,
      playerType: players.playerType,
      wasTimeout: userPicks.wasTimeout,
      portraitUrl: roundOptions.portraitUrl,
      blurb: sql<string>`(${roundOptions.blurbs} ->> ${userPicks.selectedYear}::text)`,
    })
      .from(userPicks)
      .innerJoin(challengeRounds, eq(userPicks.roundId, challengeRounds.id))
      .innerJoin(players, eq(userPicks.selectedPlayerId, players.id))
      .leftJoin(roundOptions, and(
        eq(roundOptions.roundId, userPicks.roundId),
        eq(roundOptions.playerId, players.playerId),
      ))
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
        eq(gameSessions.status, 'completed'),
      ));

    // Community stats for all rounds
    const roundIds = picks.map(p => p.roundId);
    let communityStats: ReturnType<typeof buildCommunityStats> = [];
    if (roundIds.length > 0) {
      const allStats = await db.select().from(pickStats).where(inArray(pickStats.roundId, roundIds));
      communityStats = buildCommunityStats(roundIds, allStats);
    }

    // Recalculate percentile dynamically (shifts as more players complete)
    const totalScore = toNum(session.totalLegendScore);
    const percentile = await calculateSessionPercentile(challengeId, totalScore);

    res.json({
      session: {
        totalLegendScore: totalScore,
        percentile,
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

// GET /api/challenge/:id/recap - Community most-drafted lineup vs perfect lineup (public)
router.get('/:id/recap', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);
    if (isNaN(challengeId)) {
      res.status(400).json({ error: 'Invalid challenge ID' });
      return;
    }

    // Get the challenge
    const [challenge] = await db.select({
      id: challenges.id,
      date: challenges.challengeDate,
      theme: challenges.theme,
    })
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!challenge) {
      res.status(404).json({ error: 'Challenge not found' });
      return;
    }

    // Get all rounds for this challenge
    const rounds = await db.select()
      .from(challengeRounds)
      .where(eq(challengeRounds.challengeId, challengeId))
      .orderBy(challengeRounds.roundNumber);

    if (rounds.length === 0) {
      res.status(404).json({ error: 'No rounds found' });
      return;
    }

    const roundIds = rounds.map(r => r.id);

    // Get all pick_stats for these rounds
    const allStats = await db.select()
      .from(pickStats)
      .where(inArray(pickStats.roundId, roundIds));

    // For each round, find the most-picked (playerId, selectedYear)
    const communityPicks = [];
    for (const round of rounds) {
      const roundStatEntries = allStats.filter(s => s.roundId === round.id);

      if (roundStatEntries.length === 0) continue;

      // Find the option with the highest pick count
      const best = roundStatEntries.reduce((a, b) => a.pickCount > b.pickCount ? a : b);

      // Get the player record for this pick
      const [playerRecord] = await db.select({
        id: players.id,
        playerId: players.playerId,
        nameFirst: players.nameFirst,
        nameLast: players.nameLast,
        year: players.year,
        team: players.team,
        stats: players.stats,
        categoryZscores: players.categoryZscores,
        playerType: players.playerType,
        zScorePosition: players.zScorePosition,
      })
        .from(players)
        .where(eq(players.id, best.playerId))
        .limit(1);

      if (!playerRecord) continue;

      // Get portrait and blurb from round_options
      const [option] = await db.select({
        portraitUrl: roundOptions.portraitUrl,
        blurbs: roundOptions.blurbs,
      })
        .from(roundOptions)
        .where(and(
          eq(roundOptions.roundId, round.id),
          eq(roundOptions.playerId, playerRecord.playerId),
        ))
        .limit(1);

      const blurbs = (option?.blurbs ?? {}) as Record<string, string>;
      const legendScore = calculateSandlotScore(toNum(playerRecord.zScorePosition));

      communityPicks.push({
        roundNumber: round.roundNumber,
        position: round.position,
        playerName: `${playerRecord.nameFirst ?? ''} ${playerRecord.nameLast ?? ''}`.trim(),
        year: best.selectedYear,
        team: playerRecord.team ?? '',
        legendScore,
        stats: (playerRecord.stats ?? {}) as Record<string, number>,
        categoryZscores: (playerRecord.categoryZscores ?? {}) as Record<string, number>,
        playerType: (playerRecord.playerType ?? 'batter') as 'batter' | 'pitcher',
        wasTimeout: false,
        portraitUrl: option?.portraitUrl ?? null,
        blurb: blurbs[String(best.selectedYear)] ?? undefined,
      });
    }

    const communityTotal = Math.round(
      communityPicks.reduce((sum, p) => sum + p.legendScore, 0) * 10
    ) / 10;

    // Perfect lineup
    const perfectLineup = await calculatePerfectLineup(challengeId);

    // Total participants
    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(gameSessions)
      .where(and(eq(gameSessions.challengeId, challengeId), eq(gameSessions.status, 'completed')));

    res.json({
      challenge: {
        id: challenge.id,
        date: challenge.date,
        theme: challenge.theme,
      },
      communityLineup: {
        picks: communityPicks,
        totalScore: communityTotal,
      },
      perfectLineup,
      totalParticipants: toNum(countResult?.count),
    });
  } catch (error) {
    console.error('Error fetching recap:', error);
    res.status(500).json({ error: 'Failed to fetch recap' });
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
      totalPicks: total,
      picks: roundStatEntries.map(s => ({
        playerId: s.playerId,
        year: s.selectedYear,
        count: s.pickCount,
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
      totalPicks: total,
      picks: entries.map(s => ({
        playerId: s.playerId,
        year: s.selectedYear,
        count: s.pickCount,
        percentage: total > 0 ? Math.round((s.pickCount / total) * 100) : 0,
      })),
    };
  });
}

// POST /api/challenge/:id/replay - Start a replay of a completed challenge (public, no auth)
router.post('/:id/replay', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);
    if (isNaN(challengeId)) {
      res.status(400).json({ error: 'Invalid challenge ID' });
      return;
    }

    const [challenge] = await db.select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!challenge || challenge.status !== 'completed') {
      res.status(404).json({ error: 'Challenge not found or not completed' });
      return;
    }

    const { rounds, communityStats } = await getAllRoundData(challengeId);

    res.json({
      session: { id: `replay-${challengeId}-${Date.now()}`, status: 'replay' },
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
    console.error('Replay start error:', error);
    res.status(500).json({ error: 'Failed to start replay' });
  }
});

// POST /api/challenge/:id/replay-percentile - Get real percentile for a replay score (public)
router.post('/:id/replay-percentile', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);
    if (isNaN(challengeId)) {
      res.status(400).json({ error: 'Invalid challenge ID' });
      return;
    }

    const [challenge] = await db.select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!challenge || challenge.status !== 'completed') {
      res.status(404).json({ error: 'Challenge not found or not completed' });
      return;
    }

    const { totalLegendScore } = req.body as { totalLegendScore: number };
    if (typeof totalLegendScore !== 'number') {
      res.status(400).json({ error: 'totalLegendScore required' });
      return;
    }

    const percentile = await calculateSessionPercentile(challengeId, totalLegendScore);

    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(gameSessions)
      .where(and(eq(gameSessions.challengeId, challengeId), eq(gameSessions.status, 'completed')));

    res.json({
      percentile,
      totalParticipants: toNum(countResult?.count),
    });
  } catch (error) {
    console.error('Replay percentile error:', error);
    res.status(500).json({ error: 'Failed to calculate percentile' });
  }
});

// GET /api/challenge/streak - Get current user's streak
router.get('/streak', async (req, res) => {
  try {
    const guestToken = req.headers['x-guest-token'] as string;
    const emptyStats = { current: 0, longest: 0, gamesPlayed: 0, averageScore: 0, averagePercentile: 0 };
    if (!guestToken) {
      res.json(emptyStats);
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
      res.json(emptyStats);
      return;
    }

    // Aggregate lifetime stats
    const [statsResult] = await db.select({
      gamesPlayed: sql<number>`count(*)::int`,
      averageScore: sql<number>`round(avg(${gameSessions.totalLegendScore}::numeric), 1)`,
      averagePercentile: sql<number>`round(avg(${gameSessions.percentile})::numeric)`,
    })
      .from(gameSessions)
      .where(and(
        eq(gameSessions.guestToken, guestToken),
        eq(gameSessions.status, 'completed')
      ));

    const gamesPlayed = toNum(statsResult?.gamesPlayed);
    const averageScore = toNum(statsResult?.averageScore);
    const averagePercentile = toNum(statsResult?.averagePercentile);

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

    res.json({ current: currentStreak, longest: longestStreak, gamesPlayed, averageScore, averagePercentile });
  } catch (error) {
    console.error('Streak error:', error);
    res.status(500).json({ error: 'Failed to calculate streak' });
  }
});

export default router;
