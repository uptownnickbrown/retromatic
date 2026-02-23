import OpenAI from 'openai';
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

const POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'OF', 'UTIL', 'SP', 'RP', 'P'] as const;

// ─── Session store for multi-turn conversations ──────────────

interface AgentSession {
  responseId: string;
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
      description: 'The rounds you want to curate. Omit positions to auto-fill.',
      items: {
        type: 'object' as const,
        properties: {
          position: { type: 'string' as const, description: 'Position code for this round' },
          players: {
            type: 'array' as const,
            description: '1-3 players for this round. If fewer than 3, the rest are auto-filled.',
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
        team: { type: 'string', description: '3-letter team code (e.g. NYA, BOS, LAN, PHI)' },
        position: { type: 'string', description: 'Position code (C, 1B, 2B, SS, 3B, OF, SP, RP, P, UTIL)' },
        yearMin: { type: 'number', description: 'Minimum year (inclusive)' },
        yearMax: { type: 'number', description: 'Maximum year (inclusive)' },
        name: { type: 'string', description: 'Player last name (partial match)' },
        playerType: { type: 'string', enum: ['batter', 'pitcher'], description: 'Filter by player type' },
        minSeasons: { type: 'number', description: 'Minimum qualifying seasons (default 3)' },
        limit: { type: 'number', description: 'Max players to return (default 15)' },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'preview_challenge',
    strict: false,
    description: `Preview the challenge for the user to review before submitting. ALWAYS call this before submit_challenge. The user will see the proposed lineup with Sandlot Scores and can approve or request changes. Same rules as submit_challenge — partial lineups are OK, missing positions will be auto-filled.`,
    parameters: challengeParamsSchema,
  },
  {
    type: 'function' as const,
    name: 'submit_challenge',
    strict: false,
    description: `Submit the challenge to the database. Only call this AFTER the user has approved a preview. You can submit a PARTIAL challenge — any positions you don't include will be auto-filled with random eligible players from the database.

Rules for the rounds you DO include:
- Each round needs a position and 1-3 players, each with exactly 3 year options
- All player-years must exist in the database (only use years from search_players results)
- No duplicate player-year combinations

You do NOT need to fill all 10 positions. Focus on the players that matter for the theme and let the system fill the rest.`,
    parameters: challengeParamsSchema,
  },
];

// ─── Tool execution ──────────────────────────────────────────

function buildPositionFilter(pos: string) {
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

async function executeFindEligiblePlayers(args: Record<string, unknown>): Promise<string> {
  const conditions = [];

  if (args.name) conditions.push(ilike(players.nameLast, `%${args.name}%`));
  if (args.team) conditions.push(eq(players.team, String(args.team)));
  if (args.position) conditions.push(buildPositionFilter(String(args.position))!);
  if (args.yearMin) conditions.push(gte(players.year, Number(args.yearMin)));
  if (args.yearMax) conditions.push(lte(players.year, Number(args.yearMax)));
  if (args.playerType) conditions.push(eq(players.playerType, String(args.playerType)));

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

  // Get unique player IDs from matching rows
  const playerIds = [...new Set(matchingRows.map(r => r.playerId))];
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

  // Build player info from matching rows (deduped)
  const playerInfo = new Map<string, {
    playerId: string;
    name: string;
    playerType: string;
    position: string;
    positions: string;
    bestZScore: number;
  }>();

  for (const r of matchingRows) {
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

  const minSeasons = Number(args.minSeasons) || 3;
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

// Pick 3 years for a player: best + middle + weak for variety
function pickYears(seasons: Array<{ year: number; zScore: number }>): number[] {
  const sorted = [...seasons].sort((a, b) => b.zScore - a.zScore);
  if (sorted.length <= 3) return sorted.map(s => s.year);

  const best = sorted[0];
  const mid = sorted[Math.floor(sorted.length / 2)];
  const weak = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))];

  const years = [best.year, mid.year, weak.year];
  // Dedupe: if any collide, fill from remaining
  const unique = [...new Set(years)];
  for (const s of sorted) {
    if (unique.length >= 3) break;
    if (!unique.includes(s.year)) unique.push(s.year);
  }
  return unique.slice(0, 3);
}

// Get random eligible players for a position, excluding already-used player IDs
async function getRandomEligiblePlayers(
  position: string,
  count: number,
  excludePlayerIds: Set<string>,
): Promise<Array<{ playerId: string; playerName: string; years: number[] }>> {
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
      like(players.positionsEligible, '%OF%'),
    );
  } else {
    posFilter = or(
      eq(players.primaryPosition, position),
      like(players.positionsEligible, `%${position}%`),
    );
  }

  const rows = await db.select({
    playerId: players.playerId,
    nameFirst: players.nameFirst,
    nameLast: players.nameLast,
    year: players.year,
    zScore: players.zScorePosition,
  })
    .from(players)
    .where(and(posFilter!, gte(players.zScorePosition, '-2')))
    .orderBy(desc(players.zScorePosition));

  // Group by player
  const grouped = new Map<string, {
    playerId: string;
    name: string;
    seasons: Array<{ year: number; zScore: number }>;
  }>();

  for (const r of rows) {
    if (excludePlayerIds.has(r.playerId)) continue;
    const existing = grouped.get(r.playerId);
    const season = { year: r.year, zScore: Number(r.zScore) };
    if (existing) {
      existing.seasons.push(season);
    } else {
      grouped.set(r.playerId, {
        playerId: r.playerId,
        name: `${r.nameFirst} ${r.nameLast}`,
        seasons: [season],
      });
    }
  }

  // Only players with 3+ seasons, shuffle, pick count
  const eligible = shuffle(
    Array.from(grouped.values()).filter(p => p.seasons.length >= 3)
  ).slice(0, count);

  return eligible.map(p => ({
    playerId: p.playerId,
    playerName: p.name,
    years: pickYears(p.seasons),
  }));
}

// ─── Shared validation + round building ─────────────────────

interface ValidatedRounds {
  finalRounds: SubmitRound[];
  missingPositions: string[];
  autoFilledCount: number;
}

async function validateAndBuildRounds(
  args: Record<string, unknown>,
  send: (data: Record<string, unknown>) => void,
): Promise<ValidatedRounds | { error: string }> {
  const aiRounds = (args.rounds as SubmitRound[]) || [];

  // Validate AI-provided rounds
  const errors: string[] = [];
  const allPlayerYears = new Set<string>();
  const usedPlayerIds = new Set<string>();

  for (const round of aiRounds) {
    if (!POSITIONS.includes(round.position as typeof POSITIONS[number])) {
      errors.push(`Invalid position: ${round.position}`);
      continue;
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
      usedPlayerIds.add(p.playerId);
    }
  }

  if (missingInfo.length > 0) {
    return { error: `Player-years not in database:\n${missingInfo.join('\n')}` };
  }

  // Build the final 10 rounds: AI-provided + auto-filled
  const roundsByPosition = new Map<string, SubmitRound>();
  for (const round of aiRounds) {
    roundsByPosition.set(round.position, round);
  }

  // Auto-fill missing positions and incomplete rounds
  const missingPositions = POSITIONS.filter(p => !roundsByPosition.has(p));
  const partialPositions = aiRounds.filter(r => r.players.length < 3);

  if (missingPositions.length > 0 || partialPositions.length > 0) {
    const fillCount = missingPositions.length + partialPositions.reduce((sum, r) => sum + (3 - r.players.length), 0);
    send({ type: 'thinking', message: `Auto-filling ${fillCount} player slots across ${missingPositions.length + partialPositions.length} positions...` });
  }

  // Fill completely missing positions
  for (const pos of missingPositions) {
    const randomPlayers = await getRandomEligiblePlayers(pos, 3, usedPlayerIds);
    if (randomPlayers.length < 3) {
      return { error: `Could not find enough eligible players for position ${pos}` };
    }
    for (const p of randomPlayers) usedPlayerIds.add(p.playerId);
    roundsByPosition.set(pos, { position: pos, players: randomPlayers });
  }

  // Fill partial rounds (AI provided 1-2 players, need 3)
  for (const round of partialPositions) {
    const needed = 3 - round.players.length;
    const randomPlayers = await getRandomEligiblePlayers(round.position, needed, usedPlayerIds);
    if (randomPlayers.length < needed) {
      return { error: `Could not find enough eligible players for position ${round.position}` };
    }
    for (const p of randomPlayers) usedPlayerIds.add(p.playerId);
    round.players.push(...randomPlayers);
    roundsByPosition.set(round.position, round);
  }

  // Assemble final rounds in shuffled position order (like other generators)
  const shuffledPositions = shuffle([...POSITIONS]);
  const finalRounds = shuffledPositions.map(pos => roundsByPosition.get(pos)!);

  return {
    finalRounds,
    missingPositions: [...missingPositions],
    autoFilledCount: missingPositions.length * 3 + partialPositions.reduce((sum, r) => sum + (3 - r.players.length), 0),
  };
}

// ─── Preview: enrich with z-scores and Sandlot Scores ────────

async function executePreviewChallenge(
  args: Record<string, unknown>,
  send: (data: Record<string, unknown>) => void,
): Promise<{ preview: true } | { error: string }> {
  const theme = String(args.theme);
  const result = await validateAndBuildRounds(args, send);
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

  // Build enriched proposal
  const aiRounds = (args.rounds as SubmitRound[]) || [];
  const aiPositions = new Set(aiRounds.map(r => r.position));

  const proposalRounds = result.finalRounds.map(round => ({
    position: round.position,
    autoFilled: !aiPositions.has(round.position),
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

  send({
    type: 'proposal',
    proposal: {
      theme,
      rounds: proposalRounds,
      missingPositions: result.missingPositions,
      autoFilledCount: result.autoFilledCount,
    },
  });

  return { preview: true };
}

// ─── Submit: write to DB ─────────────────────────────────────

async function executeSubmitChallenge(
  args: Record<string, unknown>,
  send: (data: Record<string, unknown>) => void,
): Promise<{ challengeId: number } | { error: string }> {
  const theme = String(args.theme);
  const result = await validateAndBuildRounds(args, send);
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

const systemPrompt = `You are an expert baseball challenge builder for the Sandlot daily game.

Your job: Create a 10-round draft challenge based on the user's prompt. Each challenge has a theme, 10 positions (C, 1B, 2B, SS, 3B, OF, UTIL, SP, RP, P), and 3 players per position with 3 year options each.

WORKFLOW:
1. Use search_players to find players that fit the user's prompt. Search by team, era, name, position — whatever matches the theme. Each result shows the player grouped with ALL their qualifying seasons.
2. From the results, pick the players you want to include. For each, choose exactly 3 years from their "years" array. NEVER guess years — only use years that appeared in results.
3. ALWAYS call preview_challenge first to show the user your proposed lineup. Wait for their feedback.
4. Only call submit_challenge after the user approves the preview. If they request changes, search again and preview again.

Focus on the players that make the theme interesting. Don't waste iterations trying to fill every position — the system handles that automatically.

EDITING WORKFLOW:
When the user requests changes to a previewed challenge:
- Only modify the rounds/players they specifically asked about
- Keep all other rounds exactly as they were in the previous preview
- Search for replacement players if needed, then call preview_challenge again with the full updated lineup
- Include ALL rounds (both changed and unchanged) in the new preview so nothing is lost

POSITIONS: Batters = C, 1B, 2B, SS, 3B, OF, UTIL. Pitchers = SP, RP, P.
DATABASE: 1961-2025. Team codes: NYA=Yankees, BOS=Red Sox, PHI=Phillies, LAN=Dodgers, SFN=Giants, SLN=Cardinals, CHN=Cubs, CHA=White Sox, etc.`;

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

  console.log(JSON.stringify({
    event: 'agent_session_start',
    sessionId: sid,
    isResume: !!existingSession,
    promptPreview: prompt.slice(0, 100),
  }));

  send({ type: 'thinking', message: existingSession ? 'Continuing conversation...' : 'Starting challenge builder...' });

  try {
    // Initial or continuation call
    let response: OpenAI.Responses.Response;
    if (existingSession) {
      // Continue existing conversation with user's new message
      response = await client.responses.create({
        model: 'gpt-5-mini',
        instructions: systemPrompt,
        previous_response_id: existingSession.responseId,
        input: prompt,
        tools,
        tool_choice: 'auto',
        max_output_tokens: 16384,
      });
    } else {
      response = await client.responses.create({
        model: 'gpt-5-mini',
        instructions: systemPrompt,
        input: prompt,
        tools,
        tool_choice: 'auto',
        max_output_tokens: 16384,
      });
    }

    let iterations = 0;
    const maxIterations = 30;

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

      if (toolCalls.length === 0) {
        // No tool calls — agent is done talking
        const messageOutput = response.output.find(
          (item): item is OpenAI.Responses.ResponseOutputMessage => item.type === 'message'
        );
        if (messageOutput) {
          const text = messageOutput.content
            .filter((c): c is OpenAI.Responses.ResponseOutputText => c.type === 'output_text')
            .map(c => c.text)
            .join('');
          if (text) send({ type: 'message', message: text });
        }
        break;
      }

      // Process each tool call
      const toolResults: OpenAI.Responses.ResponseInputItem[] = [];

      for (const toolCall of toolCalls) {
        const args = JSON.parse(toolCall.arguments);

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
        } else if (toolCall.name === 'preview_challenge') {
          const previewResult = await executePreviewChallenge(args, send);
          if ('preview' in previewResult) {
            console.log(JSON.stringify({ event: 'agent_preview_sent', sessionId: sid, theme: args.theme }));
            // Save session for continuation
            agentSessions.set(sid, { responseId: response.id, createdAt: Date.now() });
            // Tell the agent the preview was sent
            result = JSON.stringify({ success: true, message: 'Preview sent to user. Waiting for approval or feedback.' });
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
            agentSessions.set(sid, { responseId: updatedResponse.id, createdAt: Date.now() });

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

      // Continue the conversation with tool results
      response = await client.responses.create({
        model: 'gpt-5-mini',
        instructions: systemPrompt,
        previous_response_id: response.id,
        input: toolResults,
        tools,
        tool_choice: 'auto',
        max_output_tokens: 16384,
      });
    }

    if (iterations >= maxIterations) {
      console.log(JSON.stringify({ event: 'agent_max_iterations', sessionId: sid, iterations }));
      send({ type: 'error', message: 'Agent reached maximum iterations without completing' });
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'agent_error', sessionId: sid, error: String(error) }));
    send({ type: 'error', message: String(error) });
  }

  res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
  res.end();
  return null;
}
