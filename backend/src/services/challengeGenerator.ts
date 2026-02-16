import { db } from '../db/index.js';
import { players, challenges, challengeRounds, roundOptions } from '../db/schema.js';
import { sql, eq, and, inArray, desc, asc, gte, lte, like, or } from 'drizzle-orm';

const POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'OF', 'UTIL', 'SP', 'RP', 'P'] as const;

// Shuffle array (Fisher-Yates)
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Get eligible players for a position
async function getEligiblePlayers(position: string, minZScore: number = -2): Promise<Array<{
  playerId: string;
  nameFirst: string | null;
  nameLast: string | null;
  seasons: Array<{ id: number; year: number; zScorePosition: number; team: string | null }>;
}>> {
  // Build position filter
  let posFilter;
  if (position === 'UTIL') {
    posFilter = eq(players.playerType, 'batter');
  } else if (position === 'P') {
    posFilter = eq(players.playerType, 'pitcher');
  } else if (position === 'OF') {
    posFilter = or(
      like(players.positionsEligible, '%LF%'),
      like(players.positionsEligible, '%CF%'),
      like(players.positionsEligible, '%RF%'),
      like(players.positionsEligible, '%OF%')
    );
  } else {
    posFilter = or(
      eq(players.primaryPosition, position),
      like(players.positionsEligible, `%${position}%`)
    );
  }

  // Get all qualifying player-seasons
  const rows = await db.select({
    id: players.id,
    playerId: players.playerId,
    nameFirst: players.nameFirst,
    nameLast: players.nameLast,
    year: players.year,
    team: players.team,
    zScorePosition: players.zScorePosition,
  })
    .from(players)
    .where(and(
      posFilter!,
      gte(players.zScorePosition, String(minZScore))
    ))
    .orderBy(desc(players.zScorePosition));

  // Group by player
  const playerMap = new Map<string, {
    playerId: string;
    nameFirst: string | null;
    nameLast: string | null;
    seasons: Array<{ id: number; year: number; zScorePosition: number; team: string | null }>;
  }>();

  for (const row of rows) {
    const existing = playerMap.get(row.playerId);
    const season = { id: row.id, year: row.year, zScorePosition: Number(row.zScorePosition), team: row.team };
    if (existing) {
      existing.seasons.push(season);
    } else {
      playerMap.set(row.playerId, {
        playerId: row.playerId,
        nameFirst: row.nameFirst,
        nameLast: row.nameLast,
        seasons: [season],
      });
    }
  }

  // Only include players with 3+ seasons (so we can offer 3 year choices)
  return Array.from(playerMap.values()).filter(p => p.seasons.length >= 3);
}

// Pick 3 interesting years for a player: 1 good + 2 others with varying quality
function pickYears(seasons: Array<{ id: number; year: number; zScorePosition: number }>): number[] {
  const sorted = [...seasons].sort((a, b) => b.zScorePosition - a.zScorePosition);

  if (sorted.length <= 3) {
    return sorted.map(s => s.year);
  }

  // Pick the best season
  const best = sorted[0];

  // Pick a middle season (around median)
  const midIdx = Math.floor(sorted.length / 2);
  const mid = sorted[midIdx];

  // Pick a weaker season (bottom third)
  const weakIdx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
  const weak = sorted[weakIdx];

  // Make sure all 3 are different years
  const years = [best.year, mid.year, weak.year];
  const uniqueYears = [...new Set(years)];

  // If duplicates, fill from remaining
  if (uniqueYears.length < 3) {
    for (const s of sorted) {
      if (!uniqueYears.includes(s.year)) {
        uniqueYears.push(s.year);
        if (uniqueYears.length === 3) break;
      }
    }
  }

  return shuffle(uniqueYears.slice(0, 3)); // Randomize order so best isn't always first
}

// Strategy: balanced - 3 players with similar peak Z-scores
async function selectBalancedPlayers(position: string): Promise<Array<{
  playerId: string;
  playerName: string;
  yearOptions: number[];
}>> {
  const eligible = await getEligiblePlayers(position, 0);
  if (eligible.length < 3) throw new Error(`Not enough eligible players for position ${position}`);

  // Sort by best season Z-score
  const sorted = eligible
    .map(p => ({
      ...p,
      bestZ: Math.max(...p.seasons.map(s => s.zScorePosition)),
    }))
    .sort((a, b) => b.bestZ - a.bestZ);

  // Pick from the top tier (top 100 players at position by peak Z-score)
  const topTier = sorted.slice(0, Math.min(100, sorted.length));

  // Select 3 random players from this tier with similar peak Z-scores
  const shuffled = shuffle(topTier);
  const selected = shuffled.slice(0, 3);

  return selected.map(p => ({
    playerId: p.playerId,
    playerName: `${p.nameFirst} ${p.nameLast}`,
    yearOptions: pickYears(p.seasons),
  }));
}

export interface GenerateChallengeOptions {
  date?: string; // YYYY-MM-DD, defaults to unassigned
  positionOrder?: string[]; // Custom order, defaults to randomized
  theme?: string;
}

export async function generateChallenge(options: GenerateChallengeOptions = {}): Promise<number> {
  const positionOrder = options.positionOrder || shuffle([...POSITIONS]);
  const date = options.date || 'unassigned';

  // Create challenge
  const [challenge] = await db.insert(challenges).values({
    challengeDate: date,
    positionOrder: positionOrder,
    status: 'draft',
    theme: options.theme || null,
  }).returning();

  // Generate rounds
  for (let i = 0; i < positionOrder.length; i++) {
    const position = positionOrder[i];
    const roundNumber = i + 1;

    // Create round
    const [round] = await db.insert(challengeRounds).values({
      challengeId: challenge.id,
      roundNumber,
      position,
    }).returning();

    // Select 3 players for this round
    const selectedPlayers = await selectBalancedPlayers(position);

    // Create round options
    for (let j = 0; j < selectedPlayers.length; j++) {
      const player = selectedPlayers[j];
      await db.insert(roundOptions).values({
        roundId: round.id,
        playerSlot: j + 1,
        playerId: player.playerId,
        playerName: player.playerName,
        yearOptions: player.yearOptions,
      });
    }
  }

  return challenge.id;
}

// Generate multiple challenges at once
export async function generateBatch(count: number, options: GenerateChallengeOptions = {}): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const id = await generateChallenge(options);
    ids.push(id);
  }
  return ids;
}

// Assign dates to unassigned challenges
export async function scheduleChallenges(
  challengeIds: number[],
  startDate: string // YYYY-MM-DD
): Promise<void> {
  const start = new Date(startDate);

  for (let i = 0; i < challengeIds.length; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];

    await db.update(challenges)
      .set({
        challengeDate: dateStr,
        status: 'scheduled',
        publishedAt: new Date(),
      })
      .where(eq(challenges.id, challengeIds[i]));
  }
}
