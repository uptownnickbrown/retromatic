import { Router } from 'express';
import { db } from '../db/index.js';
import { challenges, challengeRounds, roundOptions, gameSessions, userPicks, pickStats, players } from '../db/schema.js';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { calculateLegendScore } from '../services/legendScore.js';
import { calculatePerfectLineup, calculateSessionPercentile } from '../services/legendScore.js';
import { toNum } from '../lib/numeric.js';

const router = Router();

// Helper to get or create guest token
function getGuestToken(req: any): string {
  return req.headers['x-guest-token'] as string || '';
}

// GET /api/challenge/today - Get today's active challenge + user's session
router.get('/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
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
        // Get their picks
        const picks = await db.select({
          roundNumber: challengeRounds.roundNumber,
          position: challengeRounds.position,
          playerName: sql<string>`${players.nameFirst} || ' ' || ${players.nameLast}`,
          year: userPicks.selectedYear,
          legendScore: userPicks.legendScore,
        })
          .from(userPicks)
          .innerJoin(challengeRounds, eq(userPicks.roundId, challengeRounds.id))
          .innerJoin(players, eq(userPicks.selectedPlayerId, players.id))
          .where(eq(userPicks.sessionId, existingSession.id))
          .orderBy(challengeRounds.roundNumber);

        session = {
          id: existingSession.id,
          currentRound: existingSession.currentRound,
          status: existingSession.status,
          totalLegendScore: toNum(existingSession.totalLegendScore),
          percentile: toNum(existingSession.percentile, 50),
          picks: picks.map(p => ({ ...p, legendScore: toNum(p.legendScore) })),
        };
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
      [session] = await db.insert(gameSessions).values({
        challengeId,
        guestToken,
        status: 'in_progress',
        currentRound: 1,
      }).returning();
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

// POST /api/challenge/:id/pick - Submit a pick
router.post('/:id/pick', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);
    const guestToken = getGuestToken(req);
    const { sessionId, roundId, playerId, year, wasTimeout } = req.body;

    if (isNaN(challengeId)) {
      res.status(400).json({ error: 'Invalid challenge ID' });
      return;
    }

    if (!sessionId || !roundId || !playerId || !year) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Validate session
    const [session] = await db.select()
      .from(gameSessions)
      .where(and(
        eq(gameSessions.id, sessionId),
        eq(gameSessions.guestToken, guestToken),
        eq(gameSessions.status, 'in_progress')
      ))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: 'Session not found or completed' });
      return;
    }

    if (session.currentRound > 10) {
      res.status(400).json({ error: 'Game already completed' });
      return;
    }

    // Validate round belongs to this challenge and matches current round
    const [round] = await db.select()
      .from(challengeRounds)
      .where(eq(challengeRounds.id, roundId))
      .limit(1);

    if (!round || round.challengeId !== challengeId || round.roundNumber !== session.currentRound) {
      res.status(400).json({ error: 'Invalid round for this session' });
      return;
    }

    // Fetch round options once for validation + blurb lookup
    const roundOptionsList = await db.select()
      .from(roundOptions)
      .where(eq(roundOptions.roundId, roundId));

    // Look up the player record for this player+year
    const [playerRecord] = await db.select()
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1);

    if (!playerRecord) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    // Calculate Legend Score
    const legendScore = calculateLegendScore(toNum(playerRecord.zScorePosition));

    // Check if pick already exists for this round (idempotent)
    const [existingPick] = await db.select()
      .from(userPicks)
      .where(and(
        eq(userPicks.sessionId, sessionId),
        eq(userPicks.roundId, roundId)
      ))
      .limit(1);

    if (!existingPick) {
      // Insert pick
      await db.insert(userPicks).values({
        sessionId,
        roundId,
        selectedPlayerId: playerId,
        selectedYear: year,
        legendScore: String(legendScore),
        wasTimeout: wasTimeout || false,
      });

      // Update pick stats (only on first submission, not retries)
      await db.execute(sql`
        INSERT INTO pick_stats (round_id, player_id, selected_year, pick_count)
        VALUES (${roundId}, ${playerId}, ${year}, 1)
        ON CONFLICT (round_id, player_id, selected_year)
        DO UPDATE SET pick_count = pick_stats.pick_count + 1, updated_at = NOW()
      `);
    }

    // Get pick percentages for this round
    const allStats = await db.select()
      .from(pickStats)
      .where(eq(pickStats.roundId, roundId));

    const totalPicks = allStats.reduce((sum, s) => sum + s.pickCount, 0);
    const pickPercentages = allStats.map(s => ({
      playerId: s.playerId,
      year: s.selectedYear,
      percentage: totalPicks > 0 ? Math.round((s.pickCount / totalPicks) * 100) : 0,
    }));

    // Find the blurb for the selected player+year (roundOptionsList already fetched above)
    let blurb = '';
    for (const opt of roundOptionsList) {
      const yearOptions = opt.yearOptions as number[];
      if (opt.playerId === playerRecord.playerId && yearOptions.includes(year)) {
        const blurbs = (opt.blurbs || {}) as Record<string, string>;
        blurb = blurbs[String(year)] || '';
        break;
      }
    }

    // Determine if this is the last round
    const isLastRound = session.currentRound === 10;
    const nextRoundNumber = session.currentRound + 1;

    if (isLastRound) {
      // Calculate total score
      const allPicks = await db.select({ legendScore: userPicks.legendScore })
        .from(userPicks)
        .where(eq(userPicks.sessionId, sessionId));

      const totalScore = allPicks.reduce((sum, p) => sum + toNum(p.legendScore), 0);
      const roundedTotal = Math.round(totalScore * 10) / 10;

      // Calculate percentile
      const percentile = await calculateSessionPercentile(challengeId, roundedTotal);

      // Complete session
      await db.update(gameSessions)
        .set({
          currentRound: 11, // past the last round
          status: 'completed',
          totalLegendScore: String(roundedTotal),
          percentile,
          completedAt: new Date(),
        })
        .where(eq(gameSessions.id, sessionId));
    } else {
      // Advance to next round
      await db.update(gameSessions)
        .set({ currentRound: nextRoundNumber })
        .where(eq(gameSessions.id, sessionId));
    }

    res.json({
      reveal: {
        legendScore,
        blurb,
        stats: playerRecord.stats,
        playerName: `${playerRecord.nameFirst} ${playerRecord.nameLast}`,
        year: playerRecord.year,
        team: playerRecord.team,
        pickPercentages,
      },
      nextRound: null, // deprecated: frontend uses front-loaded data
    });
  } catch (error) {
    console.error('Error submitting pick:', error);
    res.status(500).json({ error: 'Failed to submit pick' });
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

    res.json({
      session: {
        totalLegendScore: toNum(session.totalLegendScore),
        percentile: toNum(session.percentile, 50),
        completedAt: session.completedAt,
      },
      picks: picks.map(p => ({ ...p, legendScore: toNum(p.legendScore) })),
      perfectLineup,
      totalParticipants: toNum(countResult?.count),
    });
  } catch (error) {
    console.error('Error fetching results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Helper: bulk-fetch ALL round data for a challenge (3 queries instead of ~150)
async function getAllRoundData(challengeId: number) {
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

export default router;
