import { Router } from 'express';
import { db } from '../db/index.js';
import { drafts, picks, players, teamPool } from '../db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { calculateTeamScore, runRotoSimulation, calculateWinLoss, detectOutliers } from '../services/scoring.js';
import { generateCommentary } from '../services/commentary.js';

const router = Router();

// Roster slot configuration
const ROSTER_SLOTS = {
  C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1,
  OF1: 1, OF2: 1, OF3: 1, UTIL: 1,
  SP1: 1, SP2: 1, SP3: 1, RP1: 1, RP2: 1, P1: 1, P2: 1,
};

const BATTER_SLOTS = ['C', '1B', '2B', '3B', 'SS', 'OF1', 'OF2', 'OF3', 'UTIL'];
const PITCHER_SLOTS = ['SP1', 'SP2', 'SP3', 'RP1', 'RP2', 'P1', 'P2'];

// Create new draft
router.post('/', async (req, res) => {
  try {
    const guestToken = req.headers['x-guest-token'] as string || uuidv4();

    const result = await db.insert(drafts).values({
      guestToken,
      status: 'in_progress',
    }).returning();

    res.json({
      draftId: result[0].id,
      guestToken,
      status: 'in_progress',
      availableSlots: Object.keys(ROSTER_SLOTS),
    });
  } catch (error) {
    console.error('Create draft error:', error);
    res.status(500).json({ error: 'Failed to create draft' });
  }
});

// Get draft state
router.get('/:id', async (req, res) => {
  try {
    const draftId = parseInt(req.params.id);

    const draft = await db.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);

    if (draft.length === 0) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    // Get picks for this draft
    const draftPicks = await db.select({
      id: picks.id,
      playerId: picks.playerId,
      rosterSlot: picks.rosterSlot,
      pickOrder: picks.pickOrder,
      playerName: sql<string>`CONCAT(${players.nameFirst}, ' ', ${players.nameLast})`,
      year: players.year,
      team: players.team,
      position: players.primaryPosition,
    })
      .from(picks)
      .innerJoin(players, eq(picks.playerId, players.id))
      .where(eq(picks.draftId, draftId))
      .orderBy(picks.pickOrder);

    const filledSlots = draftPicks.map(p => p.rosterSlot);
    const availableSlots = Object.keys(ROSTER_SLOTS).filter(s => !filledSlots.includes(s));

    res.json({
      ...draft[0],
      picks: draftPicks,
      filledSlots,
      availableSlots,
      pickCount: draftPicks.length,
      isComplete: draftPicks.length >= 15,
    });
  } catch (error) {
    console.error('Get draft error:', error);
    res.status(500).json({ error: 'Failed to get draft' });
  }
});

// Make a pick
router.post('/:id/picks', async (req, res) => {
  try {
    const draftId = parseInt(req.params.id);
    const { playerId, rosterSlot } = req.body;

    if (!playerId || !rosterSlot) {
      return res.status(400).json({ error: 'playerId and rosterSlot are required' });
    }

    // Validate draft exists and is in progress
    const draft = await db.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
    if (draft.length === 0) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    if (draft[0].status !== 'in_progress') {
      return res.status(400).json({ error: 'Draft is not in progress' });
    }

    // Validate roster slot
    if (!Object.keys(ROSTER_SLOTS).includes(rosterSlot)) {
      return res.status(400).json({ error: 'Invalid roster slot' });
    }

    // Check if slot is already filled
    const existingPick = await db.select()
      .from(picks)
      .where(and(eq(picks.draftId, draftId), eq(picks.rosterSlot, rosterSlot)))
      .limit(1);
    if (existingPick.length > 0) {
      return res.status(400).json({ error: 'Roster slot already filled' });
    }

    // Check if player already drafted
    const playerAlreadyDrafted = await db.select()
      .from(picks)
      .where(and(eq(picks.draftId, draftId), eq(picks.playerId, playerId)))
      .limit(1);
    if (playerAlreadyDrafted.length > 0) {
      return res.status(400).json({ error: 'Player already drafted' });
    }

    // Get player and validate eligibility
    const player = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
    if (player.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Validate position eligibility
    const isBatterSlot = BATTER_SLOTS.includes(rosterSlot);
    const isPitcherSlot = PITCHER_SLOTS.includes(rosterSlot);
    const playerType = player[0].playerType;
    const positions = player[0].positionsEligible.split(',').map(p => p.trim());

    if (isBatterSlot && playerType !== 'batter') {
      return res.status(400).json({ error: 'Only batters can fill this slot' });
    }
    if (isPitcherSlot && playerType !== 'pitcher') {
      return res.status(400).json({ error: 'Only pitchers can fill this slot' });
    }

    // Specific position validation (excluding UTIL and P slots which are flexible)
    // Map slot names to required positions (strip only trailing numbers, not position numbers like 1B, 2B, 3B)
    const slotToPosition: Record<string, string> = {
      'C': 'C', '1B': '1B', '2B': '2B', '3B': '3B', 'SS': 'SS',
      'OF1': 'OF', 'OF2': 'OF', 'OF3': 'OF',
      'UTIL': 'UTIL',
      'SP1': 'SP', 'SP2': 'SP', 'SP3': 'SP',
      'RP1': 'RP', 'RP2': 'RP',
      'P1': 'P', 'P2': 'P',
    };
    const requiredPosition = slotToPosition[rosterSlot];

    if (requiredPosition && !['UTIL', 'P'].includes(requiredPosition)) {
      if (requiredPosition === 'OF' && !positions.some(p => ['LF', 'CF', 'RF', 'OF'].includes(p))) {
        return res.status(400).json({ error: 'Player not eligible for outfield' });
      } else if (['SP', 'RP'].includes(requiredPosition) && !positions.includes(requiredPosition)) {
        return res.status(400).json({ error: `Player not eligible for ${requiredPosition}` });
      } else if (!['OF', 'SP', 'RP'].includes(requiredPosition) && !positions.includes(requiredPosition)) {
        return res.status(400).json({ error: `Player not eligible for ${requiredPosition}` });
      }
    }

    // Get current pick count
    const currentPicks = await db.select({ count: sql<number>`count(*)` })
      .from(picks)
      .where(eq(picks.draftId, draftId));
    const pickOrder = Number(currentPicks[0].count) + 1;

    // Insert pick
    await db.insert(picks).values({
      draftId,
      playerId,
      rosterSlot,
      pickOrder,
    });

    res.json({
      success: true,
      pickOrder,
      rosterSlot,
      playerName: `${player[0].nameFirst} ${player[0].nameLast}`,
    });
  } catch (error) {
    console.error('Make pick error:', error);
    res.status(500).json({ error: 'Failed to make pick' });
  }
});

// Complete draft
router.post('/:id/complete', async (req, res) => {
  try {
    const draftId = parseInt(req.params.id);

    // Validate draft exists and has 15 picks
    const draft = await db.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
    if (draft.length === 0) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    const draftPicks = await db.select()
      .from(picks)
      .innerJoin(players, eq(picks.playerId, players.id))
      .where(eq(picks.draftId, draftId));

    if (draftPicks.length < 15) {
      return res.status(400).json({ error: `Draft incomplete: ${draftPicks.length}/15 picks made` });
    }

    // Calculate team scores
    const teamScore = await calculateTeamScore(draftPicks.map(p => p.players));

    // Run roto simulation
    const rotoResult = await runRotoSimulation(teamScore.categoryTotals);

    // Calculate win-loss record
    const winLoss = await calculateWinLoss(teamScore.categoryTotals);

    // Detect outliers
    const outliers = await detectOutliers(teamScore.categoryTotals, draftPicks.map(p => p.players));

    // Generate AI commentary
    let aiCommentary = '';
    try {
      aiCommentary = await generateCommentary(draftPicks.map(p => p.players), teamScore, rotoResult);
    } catch (e) {
      console.error('AI commentary failed:', e);
      aiCommentary = `Your team scored in the ${teamScore.percentile}th percentile! A solid draft with some notable picks.`;
    }

    // Update draft record
    await db.update(drafts)
      .set({
        status: 'completed',
        totalScore: teamScore.totalScore.toString(),
        percentile: teamScore.percentile,
        categoryScores: teamScore.categoryTotals,
        aiCommentary,
        rotoPlacement: rotoResult.placement,
        winLossRecord: winLoss,
        outlierFacts: outliers,
        completedAt: new Date(),
      })
      .where(eq(drafts.id, draftId));

    // Add to team pool
    await db.insert(teamPool).values({
      draftId,
      isSimulated: false,
      categoryTotals: teamScore.categoryTotals,
      totalScore: teamScore.totalScore.toString(),
    });

    res.json({
      success: true,
      results: {
        totalScore: teamScore.totalScore,
        percentile: teamScore.percentile,
        categoryScores: teamScore.categoryTotals,
        categoryPercentiles: teamScore.categoryPercentiles,
        rotoPlacement: rotoResult.placement,
        rotoScoreboard: rotoResult.scoreboard,
        winLossRecord: winLoss,
        outlierFacts: outliers,
        aiCommentary,
      },
    });
  } catch (error) {
    console.error('Complete draft error:', error);
    res.status(500).json({ error: 'Failed to complete draft' });
  }
});

// Get draft results
router.get('/:id/results', async (req, res) => {
  try {
    const draftId = parseInt(req.params.id);

    const draft = await db.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
    if (draft.length === 0) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    if (draft[0].status !== 'completed') {
      return res.status(400).json({ error: 'Draft not completed yet' });
    }

    // Get full player details for picks
    const draftPicks = await db.select()
      .from(picks)
      .innerJoin(players, eq(picks.playerId, players.id))
      .where(eq(picks.draftId, draftId))
      .orderBy(picks.pickOrder);

    // Calculate star ratings
    const roster = draftPicks.map(p => {
      const zScore = parseFloat(p.players.zScorePosition as string);
      let starRating: number;
      if (zScore > 2.0) starRating = 5;
      else if (zScore > 1.0) starRating = 4;
      else if (zScore > 0.0) starRating = 3;
      else if (zScore > -1.0) starRating = 2;
      else starRating = 1;

      return {
        rosterSlot: p.picks.rosterSlot,
        player: {
          id: p.players.id,
          name: `${p.players.nameFirst} ${p.players.nameLast}`,
          year: p.players.year,
          team: p.players.team,
          position: p.players.primaryPosition,
          stats: p.players.stats,
          zScorePosition: p.players.zScorePosition,
          starRating,
        },
      };
    });

    res.json({
      draft: draft[0],
      roster,
    });
  } catch (error) {
    console.error('Get results error:', error);
    res.status(500).json({ error: 'Failed to get results' });
  }
});

export default router;
