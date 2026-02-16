import { Router } from 'express';
import { db } from '../db/index.js';
import { challenges, challengeRounds, roundOptions, gameSessions, userPicks, pickStats, players } from '../db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';
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

// POST /api/challenge/:id/start - Start a new game session
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

    // Check for existing session
    const [existing] = await db.select()
      .from(gameSessions)
      .where(and(
        eq(gameSessions.challengeId, challengeId),
        eq(gameSessions.guestToken, guestToken)
      ))
      .limit(1);

    if (existing) {
      // Idempotent: return existing session with current round data
      if (existing.status === 'completed') {
        res.json({
          session: { id: existing.id, currentRound: existing.currentRound, status: 'completed' },
          round: null,
        });
        return;
      }
      const existingRound = await getRoundData(challengeId, existing.currentRound);
      res.json({
        session: { id: existing.id, currentRound: existing.currentRound },
        round: existingRound,
      });
      return;
    }

    // Create session
    const [session] = await db.insert(gameSessions).values({
      challengeId,
      guestToken,
      status: 'in_progress',
      currentRound: 1,
    }).returning();

    // Get round 1 data
    const roundData = await getRoundData(challengeId, 1);

    res.json({
      session: { id: session.id, currentRound: 1 },
      round: roundData,
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

    // Get the round's blurb for the selected player-year
    const [round] = await db.select()
      .from(challengeRounds)
      .where(eq(challengeRounds.id, roundId))
      .limit(1);

    const roundOptionsList = await db.select()
      .from(roundOptions)
      .where(eq(roundOptions.roundId, roundId));

    // Find the blurb for the selected player+year
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
    const isLastRound = session.currentRound >= 10;
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

    // Get next round data (if not last round)
    let nextRound = null;
    if (!isLastRound) {
      nextRound = await getRoundData(challengeId, nextRoundNumber);
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
      nextRound,
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

// Helper: get round data for a specific round number
async function getRoundData(challengeId: number, roundNumber: number) {
  const [round] = await db.select()
    .from(challengeRounds)
    .where(and(
      eq(challengeRounds.challengeId, challengeId),
      eq(challengeRounds.roundNumber, roundNumber)
    ))
    .limit(1);

  if (!round) return null;

  const options = await db.select()
    .from(roundOptions)
    .where(eq(roundOptions.roundId, round.id))
    .orderBy(roundOptions.playerSlot);

  // For each option, resolve the player record IDs for each year
  const playerOptions = await Promise.all(options.map(async (opt) => {
    const years = opt.yearOptions as number[];
    const yearOptionsRaw = await Promise.all(years.map(async (year) => {
      const [record] = await db.select({ id: players.id })
        .from(players)
        .where(and(
          eq(players.playerId, opt.playerId),
          eq(players.year, year)
        ))
        .limit(1);
      if (!record) {
        console.warn(`Missing player record for playerId=${opt.playerId} year=${year}`);
        return null;
      }
      return { year, playerRecordId: record.id };
    }));
    const yearOptionsWithIds = yearOptionsRaw.filter((y): y is { year: number; playerRecordId: number } => y !== null);

    return {
      slot: opt.playerSlot,
      name: opt.playerName,
      portraitUrl: opt.portraitUrl,
      yearOptions: yearOptionsWithIds,
    };
  }));

  return {
    roundId: round.id,
    roundNumber: round.roundNumber,
    position: round.position,
    players: playerOptions,
    timeLimit: 30,
  };
}

export default router;
