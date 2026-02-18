/**
 * Pre-seeds synthetic rosters for a challenge to avoid the cold-start problem.
 * Generates ~20 coherent full rosters (complete game sessions with 10 picks each),
 * biased towards higher Legend Score options. These synthetic sessions provide:
 *   1. Realistic "X% picked this" community stats on day one
 *   2. Percentile rankings for the first real users to complete the challenge
 */

import { db } from '../db/index.js';
import { challengeRounds, roundOptions, players, pickStats, gameSessions } from '../db/schema.js';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { calculateLegendScore, calculateSessionPercentile } from './legendScore.js';

const SIMULATED_COMPLETIONS = 20;
const PRESEED_TOKEN_PREFIX = 'preseed-';

interface PickOption {
  roundId: number;
  playerDbId: number;  // players.id (the DB record for this player-year)
  year: number;
  legendScore: number;
}

/**
 * Weighted random sampling: pick one option from a round's choices,
 * biased towards higher Legend Scores (weight = score^2).
 */
function samplePick(options: PickOption[]): PickOption {
  const weights = options.map(o => Math.pow(Math.max(o.legendScore, 1.0), 2));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let r = Math.random() * totalWeight;
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r <= 0) return options[i];
  }
  return options[options.length - 1]; // fallback
}

function preseedToken(challengeId: number, index: number): string {
  return `${PRESEED_TOKEN_PREFIX}${challengeId}-${index}`;
}

export async function preseedStatsForChallenge(challengeId: number): Promise<{
  roundsSeeded: number;
  totalPicks: number;
  syntheticSessions: number;
}> {
  // ── 1. Fetch all rounds and build per-round pick options ──────────

  const rounds = await db.select()
    .from(challengeRounds)
    .where(eq(challengeRounds.challengeId, challengeId))
    .orderBy(challengeRounds.roundNumber);

  if (rounds.length === 0) {
    return { roundsSeeded: 0, totalPicks: 0, syntheticSessions: 0 };
  }

  const roundIds = rounds.map(r => r.id);
  const roundPickOptions = new Map<number, PickOption[]>();

  for (const round of rounds) {
    const options = await db.select()
      .from(roundOptions)
      .where(eq(roundOptions.roundId, round.id));

    const pickOptions: PickOption[] = [];

    for (const option of options) {
      const years = option.yearOptions as number[];
      for (const year of years) {
        const [record] = await db.select({
          id: players.id,
          zScorePosition: players.zScorePosition,
        })
          .from(players)
          .where(and(
            eq(players.playerId, option.playerId),
            eq(players.year, year),
          ))
          .limit(1);

        if (record) {
          pickOptions.push({
            roundId: round.id,
            playerDbId: record.id,
            year,
            legendScore: calculateLegendScore(Number(record.zScorePosition)),
          });
        }
      }
    }

    roundPickOptions.set(round.id, pickOptions);
  }

  // ── 2. Clean up old synthetic data ────────────────────────────────

  // Delete old synthetic sessions (userPicks cascade via FK)
  await db.delete(gameSessions)
    .where(and(
      eq(gameSessions.challengeId, challengeId),
      sql`${gameSessions.guestToken} LIKE ${PRESEED_TOKEN_PREFIX + challengeId + '-%'}`,
    ));

  // Delete all pick_stats for this challenge's rounds (will rebuild from scratch)
  await db.delete(pickStats)
    .where(inArray(pickStats.roundId, roundIds));

  // ── 3. Re-aggregate pick_stats from remaining real user picks ─────

  await db.execute(sql`
    INSERT INTO pick_stats (round_id, player_id, selected_year, pick_count)
    SELECT up.round_id, up.selected_player_id, up.selected_year, count(*)::int
    FROM user_picks up
    JOIN game_sessions gs ON up.session_id = gs.id
    WHERE gs.challenge_id = ${challengeId}
      AND gs.status = 'completed'
    GROUP BY up.round_id, up.selected_player_id, up.selected_year
  `);

  // ── 4. Generate synthetic rosters ─────────────────────────────────

  interface Roster {
    picks: PickOption[];
    totalScore: number;
  }

  const rosters: Roster[] = [];

  for (let i = 0; i < SIMULATED_COMPLETIONS; i++) {
    const picks: PickOption[] = [];
    let totalScore = 0;

    for (const round of rounds) {
      const options = roundPickOptions.get(round.id);
      if (!options || options.length === 0) continue;

      const pick = samplePick(options);
      picks.push(pick);
      totalScore += pick.legendScore;
    }

    rosters.push({
      picks,
      totalScore: Math.round(totalScore * 10) / 10,
    });
  }

  // ── 5. Create synthetic sessions + picks ──────────────────────────

  let totalPicks = 0;
  const sessionIds: string[] = [];

  for (let i = 0; i < rosters.length; i++) {
    const roster = rosters[i];
    const guestToken = preseedToken(challengeId, i);

    const [session] = await db.insert(gameSessions).values({
      challengeId,
      guestToken,
      status: 'completed',
      currentRound: 11,
      totalLegendScore: String(roster.totalScore),
      completedAt: new Date(),
    }).returning();

    sessionIds.push(session.id);

    for (const pick of roster.picks) {
      await db.execute(sql`
        INSERT INTO user_picks (session_id, round_id, selected_player_id, selected_year, legend_score, was_timeout)
        VALUES (${session.id}, ${pick.roundId}, ${pick.playerDbId}, ${pick.year}, ${String(pick.legendScore)}, false)
        ON CONFLICT (session_id, round_id) DO NOTHING
      `);
      totalPicks++;
    }
  }

  // ── 6. Add synthetic picks to pick_stats ──────────────────────────

  const pickCountMap = new Map<string, { roundId: number; playerId: number; year: number; count: number }>();

  for (const roster of rosters) {
    for (const pick of roster.picks) {
      const key = `${pick.roundId}-${pick.playerDbId}-${pick.year}`;
      const existing = pickCountMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        pickCountMap.set(key, { roundId: pick.roundId, playerId: pick.playerDbId, year: pick.year, count: 1 });
      }
    }
  }

  for (const stat of pickCountMap.values()) {
    await db.execute(sql`
      INSERT INTO pick_stats (round_id, player_id, selected_year, pick_count)
      VALUES (${stat.roundId}, ${stat.playerId}, ${stat.year}, ${stat.count})
      ON CONFLICT (round_id, player_id, selected_year)
      DO UPDATE SET pick_count = pick_stats.pick_count + ${stat.count}, updated_at = NOW()
    `);
  }

  // ── 7. Assign percentiles to synthetic sessions ───────────────────

  for (const sessionId of sessionIds) {
    const [session] = await db.select({
      totalLegendScore: gameSessions.totalLegendScore,
    })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId))
      .limit(1);

    if (session) {
      const percentile = await calculateSessionPercentile(
        challengeId,
        Number(session.totalLegendScore),
      );
      await db.update(gameSessions)
        .set({ percentile })
        .where(eq(gameSessions.id, sessionId));
    }
  }

  console.log(`  Pre-seeded ${rosters.length} synthetic rosters (${totalPicks} picks) across ${rounds.length} rounds for challenge #${challengeId}`);

  return {
    roundsSeeded: rounds.length,
    totalPicks,
    syntheticSessions: rosters.length,
  };
}
