/**
 * Pre-seeds pick_stats for a challenge to avoid the cold-start problem.
 * Simulates ~20 completions with picks biased towards higher Legend Score options.
 */

import { db } from '../db/index.js';
import { challengeRounds, roundOptions, players, pickStats } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { calculateLegendScore } from './legendScore.js';

const SIMULATED_COMPLETIONS = 20;

interface PickOption {
  roundId: number;
  playerDbId: number;  // players.id (the DB record for this player-year)
  year: number;
  legendScore: number;
}

/**
 * For a round, compute a pick probability distribution biased towards
 * better Legend Scores. Each "simulated user" picks one (player, year)
 * from the 9 options (3 players × 3 years).
 */
function computePickWeights(options: PickOption[]): Map<string, number> {
  // Weight = legendScore^2 (squaring creates strong bias towards better picks)
  // A 9.0 gets weight 81, a 5.0 gets 25, a 2.0 gets 4
  const weights = options.map(o => ({
    key: `${o.playerDbId}-${o.year}`,
    option: o,
    weight: Math.pow(Math.max(o.legendScore, 1.0), 2),
  }));

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);

  // Convert to pick counts out of SIMULATED_COMPLETIONS
  // Use probabilistic rounding to ensure total = SIMULATED_COMPLETIONS
  const pickCounts = new Map<string, number>();
  let remaining = SIMULATED_COMPLETIONS;

  // Sort by weight descending so rounding favors top picks
  weights.sort((a, b) => b.weight - a.weight);

  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (i === weights.length - 1) {
      // Last one gets the remainder
      pickCounts.set(w.key, Math.max(remaining, 0));
    } else {
      const expected = (w.weight / totalWeight) * SIMULATED_COMPLETIONS;
      // Add small random jitter for variety
      const jitter = (Math.random() - 0.5) * 2;
      const count = Math.max(0, Math.round(expected + jitter));
      const capped = Math.min(count, remaining);
      pickCounts.set(w.key, capped);
      remaining -= capped;
    }
  }

  return pickCounts;
}

export async function preseedStatsForChallenge(challengeId: number): Promise<{
  roundsSeeded: number;
  totalPicks: number;
}> {
  const rounds = await db.select()
    .from(challengeRounds)
    .where(eq(challengeRounds.challengeId, challengeId))
    .orderBy(challengeRounds.roundNumber);

  let totalPicks = 0;

  for (const round of rounds) {
    const options = await db.select()
      .from(roundOptions)
      .where(eq(roundOptions.roundId, round.id));

    // Build all (player, year) options with their Legend Scores
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

    if (pickOptions.length === 0) continue;

    // Compute weighted pick distribution
    const pickCounts = computePickWeights(pickOptions);

    // Upsert into pick_stats
    for (const option of pickOptions) {
      const key = `${option.playerDbId}-${option.year}`;
      const count = pickCounts.get(key) ?? 0;
      if (count === 0) continue;

      await db.execute(sql`
        INSERT INTO pick_stats (round_id, player_id, selected_year, pick_count)
        VALUES (${option.roundId}, ${option.playerDbId}, ${option.year}, ${count})
        ON CONFLICT (round_id, player_id, selected_year)
        DO UPDATE SET pick_count = pick_stats.pick_count + ${count}, updated_at = NOW()
      `);

      totalPicks += count;
    }
  }

  console.log(`  Pre-seeded ${totalPicks} picks across ${rounds.length} rounds for challenge #${challengeId}`);

  return { roundsSeeded: rounds.length, totalPicks };
}
