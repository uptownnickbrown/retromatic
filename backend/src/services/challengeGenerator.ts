import OpenAI from 'openai';
import { db } from '../db/index.js';
import { players, challenges, challengeRounds, roundOptions } from '../db/schema.js';
import { eq, and, desc, gte, like, or } from 'drizzle-orm';
import { getTeamName, THEME_TEAMS } from '../lib/teams.js';

// Lazy-load OpenAI client
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

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
  const date = options.date || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

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

// Queue challenges — mark as scheduled (ready to be auto-promoted)
export async function queueChallenges(challengeIds: number[]): Promise<void> {
  for (const id of challengeIds) {
    await db.update(challenges)
      .set({
        status: 'scheduled',
        publishedAt: new Date(),
      })
      .where(eq(challenges.id, id));
  }
}

// Legacy alias — dates are no longer assigned manually, just queues them
export async function scheduleChallenges(
  challengeIds: number[],
  _startDate?: string
): Promise<void> {
  return queueChallenges(challengeIds);
}

// ═══════════════════════════════════════════════════════════════
// THEMED CHALLENGE GENERATION
// ═══════════════════════════════════════════════════════════════

type ThemeType = 'era' | 'team' | 'stat' | 'tier' | 'pattern' | 'random';

type PlayerSeason = { id: number; year: number; zScorePosition: number; team: string | null };

type EligiblePlayer = {
  playerId: string;
  nameFirst: string | null;
  nameLast: string | null;
  seasons: PlayerSeason[];
};

interface ThemeStrategy {
  type: ThemeType;
  label: string;
  filter: (player: EligiblePlayer) => PlayerSeason[];
}

// ─── Theme Strategy Builders ──────────────────────────────────

function eraTheme(startYear: number, endYear: number): ThemeStrategy {
  const decade = `${startYear}s`;
  return {
    type: 'era',
    label: `${decade} baseball`,
    filter: (player) => player.seasons.filter(s => s.year >= startYear && s.year <= endYear),
  };
}

function teamTheme(teamId: string): ThemeStrategy {
  const teamName = getTeamName(teamId);
  return {
    type: 'team',
    label: `${teamName} legends`,
    filter: (player) => {
      const teamSeasons = player.seasons.filter(s => s.team === teamId);
      return teamSeasons.length > 0 ? teamSeasons : [];
    },
  };
}

function statTheme(config: { stat: string; min: number; playerType: 'batter' | 'pitcher'; label: string }): ThemeStrategy {
  return {
    type: 'stat',
    label: config.label,
    // stat filtering happens at the DB level (see selectThemedPlayers), so here
    // we just pass through all seasons. The actual filtering is done in the
    // selectThemedPlayers function by checking stats JSON.
    filter: (player) => player.seasons,
    // Store config for use in selectThemedPlayers
    ...({ _statConfig: config } as any),
  };
}

function tierTheme(config: { minScore?: number; maxScore?: number; label: string }): ThemeStrategy {
  const minZ = config.minScore !== undefined ? (config.minScore - 1.0) / (10.0 - 1.0) * 12 - 2 : -2;
  const maxZ = config.maxScore !== undefined ? (config.maxScore - 1.0) / (10.0 - 1.0) * 12 - 2 : 10;
  return {
    type: 'tier',
    label: config.label,
    filter: (player) => player.seasons.filter(s => s.zScorePosition >= minZ && s.zScorePosition <= maxZ),
  };
}

function patternTheme(pattern: 'one-season-wonder' | 'iron-man' | 'late-bloomer'): ThemeStrategy {
  const labels: Record<string, string> = {
    'one-season-wonder': 'One-season wonders',
    'iron-man': 'Iron men of baseball',
    'late-bloomer': 'Late bloomers',
  };
  return {
    type: 'pattern',
    label: labels[pattern],
    filter: (player) => {
      const seasons = player.seasons;
      if (seasons.length < 3) return [];

      switch (pattern) {
        case 'one-season-wonder': {
          const zScores = seasons.map(s => s.zScorePosition);
          const best = Math.max(...zScores);
          const median = [...zScores].sort((a, b) => a - b)[Math.floor(zScores.length / 2)];
          return best > 2 * Math.max(median, 0.5) ? seasons : [];
        }
        case 'iron-man': {
          return seasons.length >= 10 ? seasons : [];
        }
        case 'late-bloomer': {
          const bestIdx = seasons.reduce((bi, s, i) =>
            s.zScorePosition > seasons[bi].zScorePosition ? i : bi, 0);
          const sortedByYear = [...seasons].sort((a, b) => a.year - b.year);
          const bestYearIdx = sortedByYear.findIndex(s => s === seasons[bestIdx]);
          return bestYearIdx >= sortedByYear.length * 0.65 ? seasons : [];
        }
        default:
          return seasons;
      }
    },
  };
}

function randomTheme(): ThemeStrategy {
  return {
    type: 'random',
    label: 'Mixed bag',
    filter: (player) => player.seasons,
  };
}

// ─── Select themed players for a position ─────────────────────

async function selectThemedPlayers(
  position: string,
  strategy: ThemeStrategy,
): Promise<Array<{ playerId: string; playerName: string; yearOptions: number[] }>> {
  const eligible = await getEligiblePlayers(position, -2);

  // Apply theme filter
  let themedPlayers = eligible
    .map(p => {
      const filteredSeasons = strategy.filter(p);
      return { ...p, filteredSeasons };
    })
    .filter(p => p.filteredSeasons.length >= 2); // Need at least 2 seasons for year variety

  // For stat themes, do additional filtering on stats
  const statConfig = (strategy as any)._statConfig;
  if (statConfig) {
    // Re-query with stats to filter
    const statFiltered: typeof themedPlayers = [];
    for (const p of themedPlayers) {
      // Check if any season meets the stat threshold
      const qualifying = [];
      for (const s of p.filteredSeasons) {
        const [record] = await db.select({ stats: players.stats, playerType: players.playerType })
          .from(players)
          .where(and(eq(players.playerId, p.playerId), eq(players.year, s.year)))
          .limit(1);
        if (record && record.playerType === statConfig.playerType) {
          const val = (record.stats as Record<string, number>)?.[statConfig.stat] ?? 0;
          if (val >= statConfig.min) qualifying.push(s);
        }
      }
      if (qualifying.length >= 2) {
        statFiltered.push({ ...p, filteredSeasons: qualifying });
      }
    }
    themedPlayers = statFiltered;
  }

  // Sort by best z-score in filtered seasons
  const sorted = themedPlayers
    .map(p => ({
      ...p,
      bestZ: Math.max(...p.filteredSeasons.map(s => s.zScorePosition)),
    }))
    .sort((a, b) => b.bestZ - a.bestZ);

  // Pick top tier, shuffle, select 3
  const pool = sorted.slice(0, Math.min(80, sorted.length));

  if (pool.length < 3) {
    // Fall back to general pool
    console.log(`  Theme fallback for ${position}: only ${pool.length} themed players, using general pool`);
    return selectBalancedPlayers(position);
  }

  const shuffled = shuffle(pool);
  const selected = shuffled.slice(0, 3);

  return selected.map(p => {
    // Use filtered seasons for year picking when we have enough, else use all
    const seasonsForYears = p.filteredSeasons.length >= 3 ? p.filteredSeasons : p.seasons;
    return {
      playerId: p.playerId,
      playerName: `${p.nameFirst} ${p.nameLast}`,
      yearOptions: pickYears(seasonsForYears),
    };
  });
}

// ─── AI Theme Name Generation ─────────────────────────────────

async function generateThemeName(
  strategyLabel: string,
  playerSummaries: string[],
): Promise<string> {
  const client = getOpenAIClient();
  if (!client) return strategyLabel;

  try {
    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      instructions: `You name daily baseball trivia challenges. Generate a creative, catchy 2-6 word theme name.

Examples:
- "The Steroid Era"
- "Oops! All Cardinals"
- "One Season Wonders"
- "Slugfest"
- "Speed Demons"
- "Late-Inning Magic"
- "Dynasty Watch"
- "The GOAT Debate"
- "Underdogs & Cult Heroes"
- "Bronx Bombers"
- "Generation Gap"

Write ONLY the theme name, nothing else. No quotes.`,
      input: `Theme hint: ${strategyLabel}\n\nPlayers in this challenge:\n${playerSummaries.join('\n')}`,
      temperature: 0.9,
      max_output_tokens: 30,
    });

    const name = response.output_text?.trim().replace(/^["']|["']$/g, '');
    return name || strategyLabel;
  } catch (error) {
    console.error('Theme name generation failed:', error);
    return strategyLabel;
  }
}

// ─── Generate a themed challenge ──────────────────────────────

export async function generateThemedChallenge(strategy: ThemeStrategy, date?: string): Promise<number> {
  const positionOrder = shuffle([...POSITIONS]);

  // Create challenge (theme will be updated after player selection)
  const [challenge] = await db.insert(challenges).values({
    challengeDate: date || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    positionOrder: positionOrder,
    status: 'draft',
    theme: strategy.label, // Placeholder, updated after AI naming
  }).returning();

  const playerSummaries: string[] = [];

  // Generate rounds
  for (let i = 0; i < positionOrder.length; i++) {
    const position = positionOrder[i];
    const roundNumber = i + 1;

    const [round] = await db.insert(challengeRounds).values({
      challengeId: challenge.id,
      roundNumber,
      position,
    }).returning();

    const selectedPlayers = await selectThemedPlayers(position, strategy);

    for (let j = 0; j < selectedPlayers.length; j++) {
      const player = selectedPlayers[j];
      await db.insert(roundOptions).values({
        roundId: round.id,
        playerSlot: j + 1,
        playerId: player.playerId,
        playerName: player.playerName,
        yearOptions: player.yearOptions,
      });

      playerSummaries.push(`${player.playerName} (${player.yearOptions.join(', ')})`);
    }
  }

  // Generate AI theme name
  const themeName = await generateThemeName(strategy.label, playerSummaries);
  await db.update(challenges)
    .set({ theme: themeName })
    .where(eq(challenges.id, challenge.id));

  console.log(`  Challenge #${challenge.id}: "${themeName}" (${strategy.type}: ${strategy.label})`);

  return challenge.id;
}

// ─── Curated batch of 25 themed strategies ────────────────────

function buildThemedBatch(count: number): ThemeStrategy[] {
  const strategies: ThemeStrategy[] = [];

  // 6 era themes
  const eras: ThemeStrategy[] = [
    eraTheme(1961, 1969),
    eraTheme(1970, 1979),
    eraTheme(1980, 1989),
    eraTheme(1990, 1999),
    eraTheme(2000, 2009),
    eraTheme(2010, 2025),
  ];

  // 4 team themes (randomized from top franchises)
  const teamPool = shuffle([...THEME_TEAMS]);
  const teams: ThemeStrategy[] = teamPool.slice(0, 4).map(t => teamTheme(t));

  // 3 stat themes
  const stats: ThemeStrategy[] = [
    statTheme({ stat: 'HR', min: 30, playerType: 'batter', label: 'Power hitters (30+ HR)' }),
    statTheme({ stat: 'SB', min: 30, playerType: 'batter', label: 'Speed demons (30+ SB)' }),
    statTheme({ stat: 'SO', min: 200, playerType: 'pitcher', label: 'Strikeout artists (200+ K)' }),
  ];

  // 3 pattern themes
  const patterns: ThemeStrategy[] = [
    patternTheme('one-season-wonder'),
    patternTheme('iron-man'),
    patternTheme('late-bloomer'),
  ];

  // 3 tier themes
  const tiers: ThemeStrategy[] = [
    tierTheme({ minScore: 8.5, label: 'All-time greats' }),
    tierTheme({ maxScore: 5.0, minScore: 2.0, label: 'Underdogs and journeymen' }),
    tierTheme({ minScore: 4.0, maxScore: 7.0, label: 'The middle class' }),
  ];

  // Assemble with variety — interleave types
  const pools = [eras, teams, stats, patterns, tiers];
  let poolIdx = 0;

  // Pull from each pool round-robin until we have enough
  while (strategies.length < count) {
    const pool = pools[poolIdx % pools.length];
    if (pool.length > 0) {
      strategies.push(pool.shift()!);
    } else {
      // Fill remaining with random
      strategies.push(randomTheme());
    }
    poolIdx++;
  }

  return shuffle(strategies); // Randomize final order
}

export async function generateThemedBatch(count: number): Promise<{
  challengeIds: number[];
  themes: string[];
}> {
  const strategies = buildThemedBatch(count);
  const challengeIds: number[] = [];
  const themes: string[] = [];

  console.log(`Generating ${count} themed challenges...`);

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    console.log(`\n[${i + 1}/${count}] ${strategy.type}: ${strategy.label}`);

    const id = await generateThemedChallenge(strategy);
    challengeIds.push(id);

    // Fetch the final theme name
    const [ch] = await db.select({ theme: challenges.theme })
      .from(challenges)
      .where(eq(challenges.id, id));
    themes.push(ch?.theme ?? strategy.label);
  }

  // Queue all (update status from draft → scheduled)
  await queueChallenges(challengeIds);

  console.log(`\nDone! ${count} themed challenges queued`);

  return { challengeIds, themes };
}
