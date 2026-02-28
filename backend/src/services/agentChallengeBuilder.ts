import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
import type { Response as SSEResponse } from 'express';
import { db } from '../db/index.js';
import { players, challenges, challengeRounds, roundOptions } from '../db/schema.js';
import { eq, and, desc, gte, lte, like, or, ilike, sql } from 'drizzle-orm';
import { queueChallenges } from './challengeGenerator.js';
import { calculateSandlotScore } from './sandlotScore.js';
import { toNum } from '../lib/numeric.js';

// Lazy-load OpenAI client
let openai: OpenAI | null = null;
function getClient(): OpenAI {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

/**
 * Stream an OpenAI Responses API call, forwarding text deltas as SSE events.
 * Returns the completed Response object for use with previous_response_id.
 */
async function streamOpenAICall(
  params: {
    model: string;
    instructions: string;
    input: string | OpenAI.Responses.ResponseInputItem[];
    previous_response_id?: string;
    tools: OpenAI.Responses.Tool[];
    tool_choice: 'auto';
    max_output_tokens: number;
  },
  send: (data: Record<string, unknown>) => void,
): Promise<OpenAI.Responses.Response> {
  const client = getClient();
  const stream: Stream<OpenAI.Responses.ResponseStreamEvent> = await client.responses.create({
    ...params,
    stream: true,
  });

  let completedResponse: OpenAI.Responses.Response | null = null;

  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      send({ type: 'message_delta', delta: event.delta });
    } else if (event.type === 'response.completed') {
      completedResponse = event.response;
    }
  }

  if (!completedResponse) throw new Error('OpenAI stream ended without completed response');
  return completedResponse;
}

const POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'OF', 'UTIL', 'SP', 'RP', 'P'] as const;

// ─── Dynamic team codes (cached) ────────────────────────────

let cachedTeamCodes: string | null = null;

// Well-known Lahman franchise ID → display name mapping
const TEAM_NAMES: Record<string, string> = {
  ANA: 'Angels', ARI: 'Diamondbacks', ATL: 'Braves', BAL: 'Orioles', BOS: 'Red Sox',
  CAL: 'Angels', CHA: 'White Sox', CHN: 'Cubs', CIN: 'Reds', CLE: 'Guardians/Indians',
  COL: 'Rockies', DET: 'Tigers', FLO: 'Marlins', HOU: 'Astros', KCA: 'Royals',
  LAA: 'Angels', LAN: 'Dodgers', MIA: 'Marlins', MIL: 'Brewers', MIN: 'Twins',
  MON: 'Expos', NYA: 'Yankees', NYN: 'Mets', OAK: 'Athletics', PHI: 'Phillies',
  PIT: 'Pirates', SDN: 'Padres', SEA: 'Mariners', SFN: 'Giants', SLN: 'Cardinals',
  TBA: 'Rays', TEX: 'Rangers', TOR: 'Blue Jays', WAS: 'Nationals', WSN: 'Nationals',
};

export async function getTeamCodesForPrompt(): Promise<string> {
  if (cachedTeamCodes) return cachedTeamCodes;

  const rows = await db.selectDistinct({ team: players.team })
    .from(players)
    .orderBy(players.team);

  const codes = rows
    .map(r => r.team)
    .filter((t): t is string => !!t)
    .map(code => {
      const name = TEAM_NAMES[code];
      return name ? `${code}=${name}` : code;
    });

  cachedTeamCodes = codes.join(', ');
  return cachedTeamCodes;
}

// ─── Session store for multi-turn conversations ──────────────

interface AgentSession {
  responseId: string;
  challengeTitle: string | null;
  createdAt: number;
}

const agentSessions = new Map<string, AgentSession>();

// Clean up sessions older than 30 minutes
function cleanupSessions() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, session] of agentSessions) {
    if (session.createdAt < cutoff) agentSessions.delete(id);
  }
}

// ─── Tool definitions for OpenAI ───────────────────────────────

const challengeParamsSchema = {
  type: 'object' as const,
  properties: {
    theme: { type: 'string' as const, description: 'Challenge theme name (2-6 words)' },
    rounds: {
      type: 'array' as const,
      description: 'The rounds of the challenge. Provide all 10 positions with 3 players each for a complete challenge.',
      items: {
        type: 'object' as const,
        properties: {
          position: { type: 'string' as const, description: 'Position code for this round' },
          players: {
            type: 'array' as const,
            description: '3 players for this round.',
            items: {
              type: 'object' as const,
              properties: {
                playerId: { type: 'string' as const, description: 'Lahman player_id' },
                playerName: { type: 'string' as const, description: 'Display name' },
                years: { type: 'array' as const, items: { type: 'number' as const }, description: '3 year options' },
              },
              required: ['playerId', 'playerName', 'years'],
            },
            minItems: 1,
            maxItems: 3,
          },
        },
        required: ['position', 'players'],
      },
      minItems: 1,
    },
  },
  required: ['theme', 'rounds'],
};

const tools: OpenAI.Responses.Tool[] = [
  {
    type: 'function' as const,
    name: 'search_players',
    strict: false,
    description: `Search for players eligible for the challenge. Filters find matching players, then returns ALL qualifying seasons for each player (not just seasons matching the filter). Only returns players with 3+ total qualifying seasons.

Each result includes: playerId, name, position, positions (all eligible), playerType, totalSeasons, and years[] (ALL qualifying years with year/team/zScore).

Example: searching {team:"BOS", yearMin:2015, yearMax:2019} finds players who played for BOS in that window, but shows ALL their career seasons — so you can pick any 3 years.`,
    parameters: {
      type: 'object',
      properties: {
        team: { type: 'string', description: '3-letter Lahman team code (e.g. NYA, BOS, LAN, PHI). Use TEAM CODES from your instructions.' },
        position: { type: 'string', description: 'Position code (C, 1B, 2B, SS, 3B, OF, SP, RP, P, UTIL)' },
        yearMin: { type: 'number', description: 'Minimum year (inclusive)' },
        yearMax: { type: 'number', description: 'Maximum year (inclusive)' },
        name: { type: 'string', description: 'Player last name (partial match, case-insensitive)' },
        firstName: { type: 'string', description: 'Player first name (partial match, case-insensitive)' },
        playerType: { type: 'string', enum: ['batter', 'pitcher'], description: 'Filter by player type' },
        minSeasons: { type: 'number', description: 'Minimum total qualifying seasons in DB (default 3, minimum 3). Use higher values like 8+ for "veterans" or "late bloomers" themes.' },
        minZScore: { type: 'number', description: 'Min z-score for matched seasons. Reference: z≈7.3 = Sandlot Score 8, z≈9.3 = Score 9.5+' },
        maxZScore: { type: 'number', description: 'Max z-score for matched seasons.' },
        statFilter: {
          type: 'object',
          description: 'Filter by a raw stat. Batters: R, HR, RBI, SB, H, AB, AVG, BB. Pitchers: W, SV, K, ERA, WHIP, IP, G, GS. Example: {stat:"HR", min:40}',
          properties: {
            stat: { type: 'string', description: 'Stat key (HR, RBI, SB, AVG, W, SV, K, ERA, WHIP, IP, etc.)' },
            min: { type: 'number', description: 'Minimum value (inclusive)' },
            max: { type: 'number', description: 'Maximum value (inclusive)' },
          },
          required: ['stat'],
        },
        excludePlayerIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Player IDs to exclude from results (e.g. players already in your lineup)',
        },
        limit: { type: 'number', description: 'Max players to return (default 15)' },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'lookup_player',
    strict: false,
    description: `Quick lookup to verify a specific player exists in the database. Returns matching players with their IDs, positions, and season counts. No minimum season requirement — shows all matches. Use this to verify a player is available before including them.`,
    parameters: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: 'First name (partial match, case-insensitive)' },
        lastName: { type: 'string', description: 'Last name (partial match, case-insensitive)' },
      },
      required: ['lastName'],
    },
  },
  {
    type: 'function' as const,
    name: 'preview_challenge',
    strict: false,
    description: `Preview the challenge for the user to review before submitting. ALWAYS call this before submit_challenge. The user will see the proposed lineup with Sandlot Scores and can approve or request changes. You can preview a partial challenge — unfilled positions will show as gaps.`,
    parameters: challengeParamsSchema,
  },
  {
    type: 'function' as const,
    name: 'submit_challenge',
    strict: false,
    description: `Submit the finished challenge to the database. Only call this AFTER the user has approved a preview. The challenge MUST have all 10 positions (C, 1B, 2B, SS, 3B, OF, UTIL, SP, RP, P) with exactly 3 players each, and each player must have exactly 3 year options.

Rules:
- All 10 positions required, 3 players each
- All player-years must exist in the database (only use years from search results)
- No duplicate player-year combinations`,
    parameters: challengeParamsSchema,
  },
];

// ─── Tool execution ──────────────────────────────────────────

export function buildPositionFilter(pos: string) {
  if (pos === 'UTIL') return eq(players.playerType, 'batter');
  if (pos === 'P') return eq(players.playerType, 'pitcher');
  if (pos === 'OF') {
    return or(
      like(players.positionsEligible, '%LF%'),
      like(players.positionsEligible, '%CF%'),
      like(players.positionsEligible, '%RF%'),
      like(players.positionsEligible, '%OF%'),
    );
  }
  return or(
    eq(players.primaryPosition, pos),
    like(players.positionsEligible, `%${pos}%`),
  );
}

export async function executeFindEligiblePlayers(args: Record<string, unknown>): Promise<string> {
  const conditions = [];

  if (args.name) conditions.push(ilike(players.nameLast, `%${args.name}%`));
  if (args.firstName) conditions.push(ilike(players.nameFirst, `%${args.firstName}%`));
  if (args.team) conditions.push(eq(players.team, String(args.team)));
  if (args.position) conditions.push(buildPositionFilter(String(args.position))!);
  if (args.yearMin) conditions.push(gte(players.year, Number(args.yearMin)));
  if (args.yearMax) conditions.push(lte(players.year, Number(args.yearMax)));
  if (args.playerType) conditions.push(eq(players.playerType, String(args.playerType)));
  if (args.minZScore) conditions.push(gte(players.zScorePosition, String(args.minZScore)));
  if (args.maxZScore) conditions.push(lte(players.zScorePosition, String(args.maxZScore)));

  // Stat filter: query JSONB stats column
  const statFilter = args.statFilter as { stat: string; min?: number; max?: number } | undefined;
  if (statFilter?.stat) {
    const statKey = String(statFilter.stat);
    if (statFilter.min != null) {
      conditions.push(sql`(${players.stats}->>${sql.raw(`'${statKey}'`)})::numeric >= ${statFilter.min}`);
    }
    if (statFilter.max != null) {
      conditions.push(sql`(${players.stats}->>${sql.raw(`'${statKey}'`)})::numeric <= ${statFilter.max}`);
    }
  }

  // Step 1: Find player-seasons matching the filters
  const matchingRows = await db.select({
    playerId: players.playerId,
    nameFirst: players.nameFirst,
    nameLast: players.nameLast,
    position: players.primaryPosition,
    playerType: players.playerType,
    positionsEligible: players.positionsEligible,
    zScore: players.zScorePosition,
  })
    .from(players)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(players.zScorePosition))
    .limit(500);

  // Get unique player IDs from matching rows, applying excludePlayerIds filter
  const excludeIds = new Set(
    Array.isArray(args.excludePlayerIds) ? (args.excludePlayerIds as string[]) : []
  );
  const playerIds = [...new Set(matchingRows.map(r => r.playerId))].filter(id => !excludeIds.has(id));
  if (playerIds.length === 0) return JSON.stringify([]);

  // Step 2: Fetch ALL seasons for those players (not just filtered ones)
  // This ensures the agent sees every available year, even outside the search range
  const allSeasons = await db.select({
    playerId: players.playerId,
    year: players.year,
    team: players.team,
    zScore: players.zScorePosition,
  })
    .from(players)
    .where(or(...playerIds.map(id => eq(players.playerId, id))))
    .orderBy(desc(players.zScorePosition));

  // Build player info from matching rows (deduped, excluding filtered)
  const playerInfo = new Map<string, {
    playerId: string;
    name: string;
    playerType: string;
    position: string;
    positions: string;
    bestZScore: number;
  }>();

  for (const r of matchingRows) {
    if (excludeIds.has(r.playerId)) continue;
    if (!playerInfo.has(r.playerId)) {
      playerInfo.set(r.playerId, {
        playerId: r.playerId,
        name: `${r.nameFirst} ${r.nameLast}`,
        playerType: r.playerType,
        position: r.position,
        positions: r.positionsEligible || r.position,
        bestZScore: Number(r.zScore),
      });
    } else {
      const info = playerInfo.get(r.playerId)!;
      if (Number(r.zScore) > info.bestZScore) info.bestZScore = Number(r.zScore);
    }
  }

  // Group all seasons by player
  const yearsByPlayer = new Map<string, Array<{ year: number; team: string; zScore: number }>>();
  for (const s of allSeasons) {
    const arr = yearsByPlayer.get(s.playerId) || [];
    arr.push({ year: s.year, team: s.team ?? '', zScore: Number(s.zScore) });
    yearsByPlayer.set(s.playerId, arr);
  }

  const minSeasons = Math.max(Number(args.minSeasons) || 3, 3);
  const limit = Number(args.limit) || 15;

  // Filter to players with enough total seasons, sort by best z-score
  const eligible = Array.from(playerInfo.values())
    .filter(p => (yearsByPlayer.get(p.playerId)?.length ?? 0) >= minSeasons)
    .sort((a, b) => b.bestZScore - a.bestZScore)
    .slice(0, limit);

  return JSON.stringify(eligible.map(p => ({
    playerId: p.playerId,
    name: p.name,
    playerType: p.playerType,
    position: p.position,
    positions: p.positions,
    totalSeasons: yearsByPlayer.get(p.playerId)?.length ?? 0,
    years: (yearsByPlayer.get(p.playerId) || [])
      .sort((a, b) => b.zScore - a.zScore)
      .map(y => ({ year: y.year, team: y.team, zScore: y.zScore })),
  })));
}

export async function executeLookupPlayer(args: Record<string, unknown>): Promise<string> {
  const conditions = [];
  if (args.lastName) conditions.push(ilike(players.nameLast, `%${args.lastName}%`));
  if (args.firstName) conditions.push(ilike(players.nameFirst, `%${args.firstName}%`));

  if (conditions.length === 0) return JSON.stringify({ error: 'lastName is required' });

  const rows = await db.select({
    playerId: players.playerId,
    nameFirst: players.nameFirst,
    nameLast: players.nameLast,
    year: players.year,
    position: players.primaryPosition,
    positions: players.positionsEligible,
    playerType: players.playerType,
    zScore: players.zScorePosition,
  })
    .from(players)
    .where(and(...conditions))
    .orderBy(desc(players.zScorePosition));

  // Group by player
  const grouped = new Map<string, {
    playerId: string;
    name: string;
    position: string;
    positions: string;
    playerType: string;
    totalSeasons: number;
    bestZScore: number;
    yearRange: string;
  }>();

  for (const r of rows) {
    const existing = grouped.get(r.playerId);
    if (existing) {
      existing.totalSeasons++;
      if (Number(r.zScore) > existing.bestZScore) existing.bestZScore = Number(r.zScore);
    } else {
      grouped.set(r.playerId, {
        playerId: r.playerId,
        name: `${r.nameFirst} ${r.nameLast}`,
        position: r.position,
        positions: r.positions || r.position,
        playerType: r.playerType,
        totalSeasons: 1,
        bestZScore: Number(r.zScore),
        yearRange: '',
      });
    }
  }

  // Compute year ranges
  for (const r of rows) {
    const g = grouped.get(r.playerId)!;
    if (!g.yearRange) {
      const years = rows.filter(x => x.playerId === r.playerId).map(x => x.year);
      g.yearRange = `${Math.min(...years)}-${Math.max(...years)}`;
    }
  }

  const results = Array.from(grouped.values())
    .sort((a, b) => b.bestZScore - a.bestZScore)
    .slice(0, 10);

  return JSON.stringify(results);
}

interface SubmitRound {
  position: string;
  players: Array<{
    playerId: string;
    playerName: string;
    years: number[];
  }>;
}

// Shuffle array (Fisher-Yates)
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ─── Shared validation + round building ─────────────────────

interface ValidatedRounds {
  finalRounds: SubmitRound[];
  missingPositions: string[];
  incompleteRounds: Array<{ position: string; have: number }>;
}

async function validateAndBuildRounds(
  args: Record<string, unknown>,
  _send: (data: Record<string, unknown>) => void,
  requireComplete: boolean,
): Promise<ValidatedRounds | { error: string }> {
  const aiRounds = (args.rounds as SubmitRound[]) || [];

  // Validate AI-provided rounds
  const errors: string[] = [];
  const allPlayerYears = new Set<string>();

  for (const round of aiRounds) {
    if (!POSITIONS.includes(round.position as typeof POSITIONS[number])) {
      errors.push(`Invalid position: ${round.position}`);
      continue;
    }
    if (requireComplete && round.players.length !== 3) {
      errors.push(`${round.position} must have exactly 3 players (has ${round.players.length})`);
    }
    for (const p of round.players) {
      if (p.years.length !== 3) {
        errors.push(`${p.playerName} must have 3 year options (has ${p.years.length})`);
        continue;
      }
      for (const year of p.years) {
        const key = `${p.playerId}-${year}`;
        if (allPlayerYears.has(key)) errors.push(`Duplicate: ${p.playerName} ${year}`);
        allPlayerYears.add(key);
      }
    }
  }

  // Check completeness for submit
  const providedPositions = new Set(aiRounds.map(r => r.position));
  const missingPositions = POSITIONS.filter(p => !providedPositions.has(p));
  const incompleteRounds = aiRounds
    .filter(r => r.players.length < 3)
    .map(r => ({ position: r.position, have: r.players.length }));

  if (requireComplete && missingPositions.length > 0) {
    errors.push(`Missing positions: ${missingPositions.join(', ')}. All 10 positions are required.`);
  }

  if (errors.length > 0) {
    return { error: `Validation failed:\n${errors.join('\n')}` };
  }

  // Verify all AI-provided player-years exist in DB
  const missingInfo: string[] = [];
  const checkedPlayers = new Set<string>();
  for (const round of aiRounds) {
    for (const p of round.players) {
      const missingForPlayer: number[] = [];
      for (const year of p.years) {
        const [exists] = await db.select({ id: players.id })
          .from(players)
          .where(and(eq(players.playerId, p.playerId), eq(players.year, year)))
          .limit(1);
        if (!exists) missingForPlayer.push(year);
      }
      if (missingForPlayer.length > 0 && !checkedPlayers.has(p.playerId)) {
        checkedPlayers.add(p.playerId);
        const actualYears = await db.select({ year: players.year })
          .from(players)
          .where(eq(players.playerId, p.playerId))
          .orderBy(players.year);
        const availableYears = actualYears.map(r => r.year).join(', ');
        missingInfo.push(
          `${p.playerName} (${p.playerId}): years ${missingForPlayer.join(', ')} not in DB. Available: [${availableYears}]`
        );
      }
    }
  }

  if (missingInfo.length > 0) {
    return { error: `Player-years not in database:\n${missingInfo.join('\n')}` };
  }

  // Assemble rounds in shuffled position order
  const roundsByPosition = new Map<string, SubmitRound>();
  for (const round of aiRounds) {
    roundsByPosition.set(round.position, round);
  }

  const shuffledPositions = shuffle([...POSITIONS]);
  const finalRounds = shuffledPositions
    .filter(pos => roundsByPosition.has(pos))
    .map(pos => roundsByPosition.get(pos)!);

  return { finalRounds, missingPositions: [...missingPositions], incompleteRounds };
}

// ─── Preview: enrich with z-scores and Sandlot Scores ────────

async function executePreviewChallenge(
  args: Record<string, unknown>,
  send: (data: Record<string, unknown>) => void,
): Promise<{ preview: true; qualitySummary: string } | { error: string }> {
  const theme = String(args.theme);
  const result = await validateAndBuildRounds(args, send, false); // preview allows gaps
  if ('error' in result) return result;

  // Collect all player-year pairs for z-score lookup
  const playerYearPairs: Array<{ playerId: string; year: number }> = [];
  for (const round of result.finalRounds) {
    for (const p of round.players) {
      for (const year of p.years) {
        playerYearPairs.push({ playerId: p.playerId, year });
      }
    }
  }

  // Batch fetch z-scores and teams
  const zScoreMap = new Map<string, number>();
  const teamMap = new Map<string, string>();
  if (playerYearPairs.length > 0) {
    const whereClauses = playerYearPairs.map(
      p => sql`(${players.playerId} = ${p.playerId} AND ${players.year} = ${p.year})`
    );
    const combined = sql.join(whereClauses, sql` OR `);
    const records = await db.select({
      playerId: players.playerId,
      year: players.year,
      zScorePosition: players.zScorePosition,
      team: players.team,
    }).from(players).where(combined);

    for (const r of records) {
      zScoreMap.set(`${r.playerId}-${r.year}`, toNum(r.zScorePosition));
      teamMap.set(`${r.playerId}-${r.year}`, r.team ?? '');
    }
  }

  // Build enriched proposal for filled rounds
  const proposalRounds = result.finalRounds.map(round => ({
    position: round.position,
    autoFilled: false,
    players: round.players.map(p => ({
      playerId: p.playerId,
      playerName: p.playerName,
      years: p.years.map(year => {
        const z = zScoreMap.get(`${p.playerId}-${year}`) ?? 0;
        return {
          year,
          team: teamMap.get(`${p.playerId}-${year}`) ?? '',
          zScore: Math.round(z * 100) / 100,
          sandlotScore: calculateSandlotScore(z),
        };
      }),
    })),
  }));

  // Add unfilled positions as empty rounds
  for (const pos of result.missingPositions) {
    proposalRounds.push({ position: pos, autoFilled: false, players: [] });
  }

  // Sort by position order
  const posOrder = POSITIONS.reduce((acc, p, i) => { acc[p] = i; return acc; }, {} as Record<string, number>);
  proposalRounds.sort((a, b) => (posOrder[a.position] ?? 99) - (posOrder[b.position] ?? 99));

  // Compute quality metrics for the model
  const filledRounds = proposalRounds.filter(r => r.players.length > 0);
  const roundBests = filledRounds.map(r =>
    Math.max(...r.players.flatMap(p => p.years.map(y => y.sandlotScore)))
  );
  const totalMaxScore = roundBests.reduce((a, b) => a + b, 0);
  const weakRounds = roundBests.filter(s => s < 8).length;

  const filledCount = filledRounds.length;
  const completeCount = filledRounds.filter(r => r.players.length === 3).length;
  const qualityParts: string[] = [];
  qualityParts.push(`${filledCount}/10 positions filled (${completeCount} complete with 3 players)`);
  if (result.missingPositions.length > 0) {
    qualityParts.push(`Unfilled: ${result.missingPositions.join(', ')}`);
  }
  if (result.incompleteRounds.length > 0) {
    qualityParts.push(`Incomplete: ${result.incompleteRounds.map(r => `${r.position} (${r.have}/3)`).join(', ')}`);
  }
  if (filledRounds.length > 0) {
    qualityParts.push(`Max possible score: ${totalMaxScore.toFixed(1)}. ${weakRounds} round(s) with best option below 8.0`);
  }
  const qualitySummary = qualityParts.join('. ');

  send({
    type: 'proposal',
    proposal: {
      theme,
      rounds: proposalRounds,
      missingPositions: result.missingPositions,
      incompleteRounds: result.incompleteRounds,
    },
  });

  return { preview: true, qualitySummary };
}

// ─── Submit: write to DB ─────────────────────────────────────

async function executeSubmitChallenge(
  args: Record<string, unknown>,
  send: (data: Record<string, unknown>) => void,
): Promise<{ challengeId: number } | { error: string }> {
  const theme = String(args.theme);
  const result = await validateAndBuildRounds(args, send, true); // submit requires all 10 positions
  if ('error' in result) return result;

  // Insert challenge
  const [challenge] = await db.insert(challenges).values({
    challengeDate: `agent-${Date.now()}`,
    positionOrder: result.finalRounds.map(r => r.position),
    status: 'draft',
    theme,
  }).returning();

  for (let i = 0; i < result.finalRounds.length; i++) {
    const round = result.finalRounds[i];
    const [dbRound] = await db.insert(challengeRounds).values({
      challengeId: challenge.id,
      roundNumber: i + 1,
      position: round.position,
    }).returning();

    for (let j = 0; j < round.players.length; j++) {
      const p = round.players[j];
      await db.insert(roundOptions).values({
        roundId: dbRound.id,
        playerSlot: j + 1,
        playerId: p.playerId,
        playerName: p.playerName,
        yearOptions: p.years,
      });
    }
  }

  // Queue it
  await queueChallenges([challenge.id]);

  return { challengeId: challenge.id };
}

// ─── Main agent loop ─────────────────────────────────────────

function buildSystemPrompt(teamCodes: string): string {
  return `You are an expert baseball challenge builder for the Sandlot daily game.

Your job: Create a 10-round draft challenge based on the user's prompt. Each challenge has a theme, 10 positions, and 3 players per position with 3 year options each.

COMMUNICATION:
- Before your first search, explain your interpretation of the theme and your strategy in 1-2 sentences.
- After reviewing search results, briefly note what you found and any concerns before proceeding.
- When presenting a preview, summarize why these players fit the theme.
- Track your progress: after searches, note which positions you've filled and which remain (e.g. "Covered: C, 1B, OF, SP. Still need: 2B, SS, 3B, UTIL, RP, P.").

THEME VALIDATION:
- Use your world knowledge to validate every pick against the theme. Search results are keyword matches — they need YOUR judgment to determine actual theme fit.
- A search by last name returns everyone with that name, not just the person you want. A search by team returns everyone who played there, not just the ones relevant to your theme.
- If a search returns players who don't fit, exclude them. If uncertain, use lookup_player to verify or skip them.

WORKFLOW:
1. Use search_players to find players fitting the theme. Each result shows the player with ALL qualifying seasons.
2. Pick players and choose exactly 3 years from their "years" array. NEVER guess years — only use years from results.
3. ALWAYS call preview_challenge first to show the user your proposed lineup. Wait for feedback.
4. Only call submit_challenge after the user approves. If they request changes, search and preview again.

COVERAGE:
- You must curate all 10 positions with 3 players each. There is NO auto-fill. Any position you don't provide will show as UNFILLED.
- Think about the board holistically. Players can cross positions — use the "positions" field to assign them flexibly. If you need a 2B and a themed player is listed as "SS,2B", put them at 2B.
- When a theme involves groups (families, teammates, rivals), spread them across different positions — that's great and makes the draft more interesting.
- Use excludePlayerIds in search_players to avoid seeing players you've already placed.
- Use statFilter to search by raw stats (HR, SB, W, ERA, etc.) for stat-based themes.

DRAFT QUALITY:
- Every round should have at least one player-year with a Sandlot Score of 8+ (z-score ≥ 7.3). The max possible total score (picking the best option each round) should be ≥ 70.
- Variety is good but not formulaic. Sometimes all 3 options are great. Sometimes 2 are mediocre but one has a golden hidden season. Surprising bad seasons from great players are interesting too.
- Check these targets before calling preview_challenge. If a round is weak, search for a stronger themed player.

EDITING WORKFLOW:
- When the user requests changes: ONLY modify the specific rounds/players they mentioned.
- Preserve every other round EXACTLY as-is.
- Search for themed replacements — never introduce off-theme players unless asked.
- Include ALL rounds (changed + unchanged) in the new preview.

POSITIONS: Batters = C, 1B, 2B, SS, 3B, OF, UTIL. Pitchers = SP, RP, P.
DATABASE: 1961-2025, MLB only. Players need 3+ qualifying seasons to appear in search.
TEAM CODES: ${teamCodes}`;
}

export async function runAgentBuilder(
  prompt: string,
  res: SSEResponse,
  sessionId?: string,
): Promise<number | null> {
  const client = getClient();
  cleanupSessions();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Generate or reuse session ID
  const sid = sessionId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  send({ type: 'session', sessionId: sid });

  const existingSession = sessionId ? agentSessions.get(sessionId) : null;
  let challengeTitle = existingSession?.challengeTitle ?? null;

  // Send existing title immediately so the frontend can show it
  if (challengeTitle) {
    send({ type: 'theme', title: challengeTitle });
  }

  console.log(JSON.stringify({
    event: 'agent_session_start',
    sessionId: sid,
    isResume: !!existingSession,
    challengeTitle,
    promptPreview: prompt.slice(0, 100),
  }));

  send({ type: 'thinking', message: existingSession ? 'Continuing conversation...' : 'Starting challenge builder...' });

  try {
    // Load team codes (cached after first call)
    const teamCodes = await getTeamCodesForPrompt();
    const systemPrompt = buildSystemPrompt(teamCodes);

    // Initial or continuation call — streamed so text appears in real-time
    const baseParams = {
      model: 'gpt-5-mini',
      instructions: systemPrompt,
      tools,
      tool_choice: 'auto' as const,
      max_output_tokens: 16384,
    };
    let response: OpenAI.Responses.Response;
    if (existingSession) {
      // Prefix continuation with challenge title to reinforce context
      const contextPrefix = challengeTitle
        ? `[Continuing work on challenge: "${challengeTitle}"]\n\nUser feedback: `
        : '[Continuing conversation]\n\nUser feedback: ';
      response = await streamOpenAICall(
        { ...baseParams, previous_response_id: existingSession.responseId, input: contextPrefix + prompt },
        send,
      );
    } else {
      response = await streamOpenAICall({ ...baseParams, input: prompt }, send);
    }

    let iterations = 0;
    const maxIterations = 100;
    const checkpointAt = 50;

    while (iterations < maxIterations) {
      iterations++;

      // Check for tool calls
      const toolCalls = response.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call'
      );

      console.log(JSON.stringify({
        event: 'agent_iteration',
        sessionId: sid,
        iteration: iterations,
        toolCount: toolCalls.length,
        tools: toolCalls.map(t => t.name),
        responseId: response.id,
      }));

      // Text was already streamed to the client via message_delta events.
      // For the first iteration, text came from the initial streamOpenAICall.
      // For subsequent iterations, text came from the tool-result continuation stream.

      if (toolCalls.length === 0) break;

      // Process each tool call
      const toolResults: OpenAI.Responses.ResponseInputItem[] = [];

      for (const toolCall of toolCalls) {
        const args = JSON.parse(toolCall.arguments);

        // Extract challenge title from preview/submit tool calls
        if ((toolCall.name === 'preview_challenge' || toolCall.name === 'submit_challenge') && args.theme && args.theme !== challengeTitle) {
          challengeTitle = args.theme;
          send({ type: 'theme', title: challengeTitle });
        }

        send({ type: 'tool_call', tool: toolCall.name, args });

        let result: string;
        if (toolCall.name === 'search_players') {
          result = await executeFindEligiblePlayers(args);
          const parsed = JSON.parse(result);
          console.log(JSON.stringify({
            event: 'agent_tool_result',
            sessionId: sid,
            tool: 'search_players',
            playerCount: Array.isArray(parsed) ? parsed.length : 0,
            resultSize: result.length,
          }));
          // Send search result summary to user
          if (Array.isArray(parsed) && parsed.length > 0) {
            const names = parsed.slice(0, 5).map((p: { name: string }) => p.name).join(', ');
            const suffix = parsed.length > 5 ? `, +${parsed.length - 5} more` : '';
            send({ type: 'thinking', message: `Found ${parsed.length} players: ${names}${suffix}` });
          } else {
            send({ type: 'thinking', message: 'No players matched this search.' });
          }
        } else if (toolCall.name === 'lookup_player') {
          result = await executeLookupPlayer(args);
          const parsed = JSON.parse(result);
          console.log(JSON.stringify({
            event: 'agent_tool_result',
            sessionId: sid,
            tool: 'lookup_player',
            matchCount: Array.isArray(parsed) ? parsed.length : 0,
          }));
          if (Array.isArray(parsed) && parsed.length > 0) {
            const names = parsed.map((p: { name: string; totalSeasons: number }) => `${p.name} (${p.totalSeasons} seasons)`).join(', ');
            send({ type: 'thinking', message: `Found: ${names}` });
          } else {
            send({ type: 'thinking', message: `No match for "${args.firstName || ''} ${args.lastName || ''}".` });
          }
        } else if (toolCall.name === 'preview_challenge') {
          const previewResult = await executePreviewChallenge(args, send);
          if ('preview' in previewResult) {
            console.log(JSON.stringify({ event: 'agent_preview_sent', sessionId: sid, theme: args.theme }));
            // Save session for continuation
            agentSessions.set(sid, { responseId: response.id, challengeTitle, createdAt: Date.now() });
            // Tell the agent the preview was sent, including quality metrics
            result = JSON.stringify({ success: true, message: `Preview sent to user. ${previewResult.qualitySummary}. Waiting for approval or feedback.` });
            toolResults.push({
              type: 'function_call_output',
              call_id: toolCall.call_id,
              output: result,
            });

            // Save updated response with tool result so we can continue later
            const updatedResponse = await client.responses.create({
              model: 'gpt-5-mini',
              instructions: systemPrompt,
              previous_response_id: response.id,
              input: toolResults,
              tools,
              tool_choice: 'none',
              max_output_tokens: 256,
            });
            agentSessions.set(sid, { responseId: updatedResponse.id, challengeTitle, createdAt: Date.now() });

            // Send awaiting_feedback and end the stream
            send({ type: 'awaiting_feedback', sessionId: sid });
            res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
            res.end();
            return null;
          }
          result = JSON.stringify(previewResult);
          console.log(JSON.stringify({ event: 'agent_validation_error', sessionId: sid, tool: 'preview_challenge', error: (previewResult as { error: string }).error }));
          send({ type: 'error_recoverable', message: (previewResult as { error: string }).error });
        } else if (toolCall.name === 'submit_challenge') {
          const submitResult = await executeSubmitChallenge(args, send);
          if ('challengeId' in submitResult) {
            console.log(JSON.stringify({ event: 'agent_challenge_submitted', sessionId: sid, challengeId: submitResult.challengeId, theme: args.theme }));
            // Clean up session
            agentSessions.delete(sid);
            send({ type: 'success', challengeId: submitResult.challengeId, theme: args.theme });
            res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
            res.end();
            return submitResult.challengeId;
          }
          result = JSON.stringify(submitResult);
          console.log(JSON.stringify({ event: 'agent_validation_error', sessionId: sid, tool: 'submit_challenge', error: (submitResult as { error: string }).error }));
          send({ type: 'error_recoverable', message: (submitResult as { error: string }).error });
        } else {
          result = JSON.stringify({ error: `Unknown tool: ${toolCall.name}` });
        }

        toolResults.push({
          type: 'function_call_output',
          call_id: toolCall.call_id,
          output: result,
        });
      }

      // Checkpoint: pause at 50 iterations and ask user to confirm continuing
      if (iterations === checkpointAt) {
        // Send tool results so the conversation state is up to date
        const checkpointResponse = await client.responses.create({
          model: 'gpt-5-mini',
          instructions: systemPrompt,
          previous_response_id: response.id,
          input: toolResults,
          tools,
          tool_choice: 'none',
          max_output_tokens: 256,
        });
        agentSessions.set(sid, { responseId: checkpointResponse.id, challengeTitle, createdAt: Date.now() });

        console.log(JSON.stringify({ event: 'agent_checkpoint', sessionId: sid, iterations }));
        send({ type: 'message', message: 'This is taking a while — I\'ve done a lot of searching. Want me to keep going, or should I work with what I\'ve found so far?' });
        send({ type: 'awaiting_feedback', sessionId: sid });
        res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
        res.end();
        return null;
      }

      // Continue the conversation with tool results — streamed for real-time text
      response = await streamOpenAICall(
        { ...baseParams, previous_response_id: response.id, input: toolResults },
        send,
      );
    }

    // Save session so the user can continue the conversation
    // (the agent may have asked a clarifying question, or hit max iterations)
    agentSessions.set(sid, { responseId: response.id, challengeTitle, createdAt: Date.now() });

    if (iterations >= maxIterations) {
      console.log(JSON.stringify({ event: 'agent_max_iterations', sessionId: sid, iterations }));
      send({ type: 'error', message: 'Agent reached maximum iterations without completing. Try a simpler prompt or break it into parts.' });
    }

    // Let the frontend know it can continue this session
    send({ type: 'awaiting_feedback', sessionId: sid });
  } catch (error) {
    console.error(JSON.stringify({ event: 'agent_error', sessionId: sid, error: String(error) }));
    send({ type: 'error', message: String(error) });
  }

  res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
  res.end();
  return null;
}
