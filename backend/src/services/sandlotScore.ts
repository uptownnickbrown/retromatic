import { db } from '../db/index.js';
import { players, challengeRounds, roundOptions, gameSessions } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { toNum } from '../lib/numeric.js';

// Sandlot Score: maps position-adjusted Z-score to a 1.0-10.0 scale
// Calibrated against actual distribution:
//   P50 (z=0) → ~2.7   P75 (z=3) → ~5.2   P90 (z=6) → ~7.7   P99 (z=10) → 10.0
const MIN_Z = -2;
const MAX_Z = 10;
const MIN_SCORE = 1.0;
const MAX_SCORE = 10.0;

export function calculateSandlotScore(zScorePosition: number): number {
  const clamped = Math.max(MIN_Z, Math.min(MAX_Z, zScorePosition));
  const normalized = (clamped - MIN_Z) / (MAX_Z - MIN_Z);
  const score = MIN_SCORE + normalized * (MAX_SCORE - MIN_SCORE);
  return Math.round(score * 10) / 10; // One decimal place
}

export function getSandlotScoreLabel(score: number): string {
  if (score >= 9.5) return 'Sandlot Legend';
  if (score >= 8.5) return 'Elite';
  if (score >= 7.0) return 'All-Star';
  if (score >= 5.0) return 'Solid';
  if (score >= 3.0) return 'Average';
  return 'Below Average';
}

export function getSandlotScoreColor(score: number): string {
  if (score >= 9.0) return 'gold';
  if (score >= 7.0) return 'green';
  if (score >= 5.0) return 'neutral';
  if (score >= 3.0) return 'yellow';
  return 'red';
}

// Enriched perfect lineup pick — includes stats, blurbs, player type for head-to-head
export interface EnrichedPerfectPick {
  roundNumber: number;
  position: string;
  playerName: string;
  year: number;
  legendScore: number;
  stats?: Record<string, number>;
  categoryZscores?: Record<string, number>;
  playerType?: 'batter' | 'pitcher';
  team?: string;
  blurb?: string;
}

// Find the best possible pick for each round in a challenge
export async function calculatePerfectLineup(challengeId: number): Promise<{
  picks: EnrichedPerfectPick[];
  totalScore: number;
}> {
  const rounds = await db.select()
    .from(challengeRounds)
    .where(eq(challengeRounds.challengeId, challengeId))
    .orderBy(challengeRounds.roundNumber);

  const picks: EnrichedPerfectPick[] = [];

  for (const round of rounds) {
    const options = await db.select()
      .from(roundOptions)
      .where(eq(roundOptions.roundId, round.id));

    let bestScore = -Infinity;
    let bestPick: EnrichedPerfectPick = { roundNumber: round.roundNumber, position: round.position, playerName: '', year: 0, legendScore: 0 };

    for (const option of options) {
      const years = option.yearOptions as number[];
      const blurbs = (option.blurbs ?? {}) as Record<string, string>;

      for (const year of years) {
        const [playerRecord] = await db.select()
          .from(players)
          .where(and(
            eq(players.playerId, option.playerId),
            eq(players.year, year)
          ))
          .limit(1);

        if (playerRecord) {
          const legendScore = calculateSandlotScore(toNum(playerRecord.zScorePosition));
          if (legendScore > bestScore) {
            bestScore = legendScore;
            bestPick = {
              roundNumber: round.roundNumber,
              position: round.position,
              playerName: option.playerName,
              year,
              legendScore,
              stats: (playerRecord.stats ?? {}) as Record<string, number>,
              categoryZscores: (playerRecord.categoryZscores ?? {}) as Record<string, number>,
              playerType: (playerRecord.playerType ?? 'batter') as 'batter' | 'pitcher',
              team: playerRecord.team ?? undefined,
              blurb: blurbs[String(year)] ?? undefined,
            };
          }
        }
      }
    }

    picks.push(bestPick);
  }

  const totalScore = picks.reduce((sum, p) => sum + p.legendScore, 0);
  return { picks, totalScore: Math.round(totalScore * 10) / 10 };
}

// Calculate a session's percentile rank among all completed sessions for the same challenge.
// Uses dense rank: same score = same percentile (COUNT DISTINCT scores below / other distinct scores).
// Denominator excludes the player's own score so 100/100 → 100th percentile.
export async function calculateSessionPercentile(
  challengeId: number,
  totalLegendScore: number
): Promise<number> {
  const [result] = await db.select({
    totalDistinct: sql<number>`count(distinct ${gameSessions.totalLegendScore})`,
    belowDistinct: sql<number>`count(distinct ${gameSessions.totalLegendScore}) filter (where ${gameSessions.totalLegendScore} < ${totalLegendScore})`,
  })
    .from(gameSessions)
    .where(and(
      eq(gameSessions.challengeId, challengeId),
      eq(gameSessions.status, 'completed')
    ));

  const totalDistinct = toNum(result?.totalDistinct);
  const belowDistinct = toNum(result?.belowDistinct);
  if (totalDistinct <= 1) return 50; // Only one player, default to 50th
  return Math.min(100, Math.max(0, Math.round((belowDistinct / (totalDistinct - 1)) * 100)));
}
