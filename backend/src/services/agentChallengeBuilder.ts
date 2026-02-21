import OpenAI from 'openai';
import type { Response as SSEResponse } from 'express';
import { db } from '../db/index.js';
import { players, challenges, challengeRounds, roundOptions } from '../db/schema.js';
import { eq, and, desc, gte, lte, like, or, ilike } from 'drizzle-orm';
import { queueChallenges } from './challengeGenerator.js';

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

// ─── Tool definitions for OpenAI ───────────────────────────────

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
    name: 'submit_challenge',
    strict: false,
    description: `Submit the challenge. You can submit a PARTIAL challenge — any positions you don't include will be auto-filled with random eligible players from the database.

Rules for the rounds you DO include:
- Each round needs a position and 1-3 players, each with exactly 3 year options
- All player-years must exist in the database (only use years from search_players results)
- No duplicate player-year combinations

You do NOT need to fill all 10 positions. Focus on the players that matter for the theme and let the system fill the rest. For example, if the prompt is about Phillies and Red Sox, just include the PHI/BOS players you care about and skip positions you can't fill thematically.`,
    parameters: {
      type: 'object',
      properties: {
        theme: { type: 'string', description: 'Challenge theme name (2-6 words)' },
        rounds: {
          type: 'array',
          description: 'The rounds you want to curate. Omit positions to auto-fill.',
          items: {
            type: 'object',
            properties: {
              position: { type: 'string', description: 'Position code for this round' },
              players: {
                type: 'array',
                description: '1-3 players for this round. If fewer than 3, the rest are auto-filled.',
                items: {
                  type: 'object',
                  properties: {
                    playerId: { type: 'string', description: 'Lahman player_id' },
                    playerName: { type: 'string', description: 'Display name' },
                    years: { type: 'array', items: { type: 'number' }, description: '3 year options' },
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
    },
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

async function executeSubmitChallenge(
  args: Record<string, unknown>,
  send: (data: Record<string, unknown>) => void,
): Promise<{ challengeId: number } | { error: string }> {
  const theme = String(args.theme);
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

  // Assemble final rounds in position order
  const finalRounds = POSITIONS.map(pos => roundsByPosition.get(pos)!);

  // Insert challenge
  const [challenge] = await db.insert(challenges).values({
    challengeDate: `agent-${Date.now()}`,
    positionOrder: finalRounds.map(r => r.position),
    status: 'draft',
    theme,
  }).returning();

  for (let i = 0; i < finalRounds.length; i++) {
    const round = finalRounds[i];
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

export async function runAgentBuilder(prompt: string, res: SSEResponse): Promise<void> {
  const client = getClient();

  const systemPrompt = `You are an expert baseball challenge builder for the Sandlot daily game.

Your job: Create a 10-round draft challenge based on the user's prompt. Each challenge has a theme, 10 positions (C, 1B, 2B, SS, 3B, OF, UTIL, SP, RP, P), and 3 players per position with 3 year options each.

WORKFLOW:
1. Use search_players to find players that fit the user's prompt. Search by team, era, name, position — whatever matches the theme. Each result shows the player grouped with ALL their qualifying seasons.
2. From the results, pick the players you want to include. For each, choose exactly 3 years from their "years" array. NEVER guess years — only use years that appeared in results.
3. Call submit_challenge with the players you curated. You do NOT need to fill all 10 positions — any positions you skip will be auto-filled with random eligible players. You can also submit 1-2 players for a position and the rest will be filled in.

Focus on the players that make the theme interesting. Don't waste iterations trying to fill every position — the system handles that automatically.

POSITIONS: Batters = C, 1B, 2B, SS, 3B, OF, UTIL. Pitchers = SP, RP, P.
DATABASE: 1961-2025. Team codes: NYA=Yankees, BOS=Red Sox, PHI=Phillies, LAN=Dodgers, SFN=Giants, SLN=Cardinals, CHN=Cubs, CHA=White Sox, etc.`;

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({ type: 'thinking', message: 'Starting challenge builder...' });

  try {
    // Initial call
    let response = await client.responses.create({
      model: 'gpt-4.1-mini',
      instructions: systemPrompt,
      input: prompt,
      tools,
      tool_choice: 'auto',
      max_output_tokens: 16384,
    });

    let iterations = 0;
    const maxIterations = 30;

    while (iterations < maxIterations) {
      iterations++;

      // Check for tool calls
      const toolCalls = response.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call'
      );

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
        } else if (toolCall.name === 'submit_challenge') {
          const submitResult = await executeSubmitChallenge(args, send);
          if ('challengeId' in submitResult) {
            send({ type: 'success', challengeId: submitResult.challengeId, theme: args.theme });
            res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
            res.end();
            return;
          }
          result = JSON.stringify(submitResult);
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
        model: 'gpt-4.1-mini',
        instructions: systemPrompt,
        previous_response_id: response.id,
        input: toolResults,
        tools,
        tool_choice: 'auto',
        max_output_tokens: 16384,
      });
    }

    if (iterations >= maxIterations) {
      send({ type: 'error', message: 'Agent reached maximum iterations without completing' });
    }
  } catch (error) {
    send({ type: 'error', message: String(error) });
  }

  res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
  res.end();
}
