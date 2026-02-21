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
    description: 'Search for player-seasons in the database. Returns matching player names, years, teams, positions, and z-scores.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Player last name (partial match)' },
        team: { type: 'string', description: '3-letter team code (e.g. NYA, BOS, LAN)' },
        position: { type: 'string', description: 'Position code (C, 1B, 2B, SS, 3B, OF, SP, RP, P, UTIL)' },
        yearMin: { type: 'number', description: 'Minimum year (inclusive)' },
        yearMax: { type: 'number', description: 'Maximum year (inclusive)' },
        minZScore: { type: 'number', description: 'Minimum position z-score' },
        playerType: { type: 'string', enum: ['batter', 'pitcher'], description: 'Filter by player type' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'get_player_seasons',
    strict: false,
    description: 'Get all qualifying seasons for a specific player by their Lahman player_id.',
    parameters: {
      type: 'object',
      properties: {
        playerId: { type: 'string', description: 'Lahman player_id (e.g. troutmi01)' },
      },
      required: ['playerId'],
    },
  },
  {
    type: 'function' as const,
    name: 'get_position_leaders',
    strict: false,
    description: 'Get the top N players at a position by z-score.',
    parameters: {
      type: 'object',
      properties: {
        position: { type: 'string', description: 'Position code' },
        limit: { type: 'number', description: 'How many to return (default 10)' },
      },
      required: ['position'],
    },
  },
  {
    type: 'function' as const,
    name: 'submit_challenge',
    strict: false,
    description: 'Submit the final 10-round challenge. Each round has a position and 3 players, each with 3 year options. All positions must be covered, all player-years must exist in the database, and no duplicates are allowed.',
    parameters: {
      type: 'object',
      properties: {
        theme: { type: 'string', description: 'Challenge theme name (2-6 words)' },
        rounds: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              position: { type: 'string', description: 'Position code for this round' },
              players: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    playerId: { type: 'string', description: 'Lahman player_id' },
                    playerName: { type: 'string', description: 'Display name' },
                    years: { type: 'array', items: { type: 'number' }, description: '3 year options' },
                  },
                  required: ['playerId', 'playerName', 'years'],
                },
                minItems: 3,
                maxItems: 3,
              },
            },
            required: ['position', 'players'],
          },
          minItems: 10,
          maxItems: 10,
        },
      },
      required: ['theme', 'rounds'],
    },
  },
];

// ─── Tool execution ──────────────────────────────────────────

async function executeSearchPlayers(args: Record<string, unknown>): Promise<string> {
  const conditions = [];

  if (args.name) {
    conditions.push(ilike(players.nameLast, `%${args.name}%`));
  }
  if (args.team) {
    conditions.push(eq(players.team, String(args.team)));
  }
  if (args.position) {
    const pos = String(args.position);
    if (pos === 'UTIL') {
      conditions.push(eq(players.playerType, 'batter'));
    } else if (pos === 'P') {
      conditions.push(eq(players.playerType, 'pitcher'));
    } else if (pos === 'OF') {
      conditions.push(or(
        like(players.positionsEligible, '%LF%'),
        like(players.positionsEligible, '%CF%'),
        like(players.positionsEligible, '%RF%'),
        like(players.positionsEligible, '%OF%'),
      ));
    } else {
      conditions.push(or(
        eq(players.primaryPosition, pos),
        like(players.positionsEligible, `%${pos}%`),
      ));
    }
  }
  if (args.yearMin) conditions.push(gte(players.year, Number(args.yearMin)));
  if (args.yearMax) conditions.push(lte(players.year, Number(args.yearMax)));
  if (args.minZScore) conditions.push(gte(players.zScorePosition, String(args.minZScore)));
  if (args.playerType) conditions.push(eq(players.playerType, String(args.playerType)));

  const rows = await db.select({
    playerId: players.playerId,
    nameFirst: players.nameFirst,
    nameLast: players.nameLast,
    year: players.year,
    team: players.team,
    position: players.primaryPosition,
    zScore: players.zScorePosition,
  })
    .from(players)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(players.zScorePosition))
    .limit(Number(args.limit) || 20);

  return JSON.stringify(rows.map(r => ({
    playerId: r.playerId,
    name: `${r.nameFirst} ${r.nameLast}`,
    year: r.year,
    team: r.team,
    position: r.position,
    zScore: Number(r.zScore),
  })));
}

async function executeGetPlayerSeasons(args: Record<string, unknown>): Promise<string> {
  const rows = await db.select({
    playerId: players.playerId,
    nameFirst: players.nameFirst,
    nameLast: players.nameLast,
    year: players.year,
    team: players.team,
    position: players.primaryPosition,
    zScore: players.zScorePosition,
    playerType: players.playerType,
  })
    .from(players)
    .where(eq(players.playerId, String(args.playerId)))
    .orderBy(desc(players.zScorePosition));

  if (rows.length === 0) return JSON.stringify({ error: 'Player not found' });

  return JSON.stringify({
    playerId: rows[0].playerId,
    name: `${rows[0].nameFirst} ${rows[0].nameLast}`,
    playerType: rows[0].playerType,
    seasons: rows.map(r => ({
      year: r.year,
      team: r.team,
      position: r.position,
      zScore: Number(r.zScore),
    })),
  });
}

async function executeGetPositionLeaders(args: Record<string, unknown>): Promise<string> {
  const pos = String(args.position);
  const limit = Number(args.limit) || 10;

  let posFilter;
  if (pos === 'UTIL') posFilter = eq(players.playerType, 'batter');
  else if (pos === 'P') posFilter = eq(players.playerType, 'pitcher');
  else if (pos === 'OF') {
    posFilter = or(
      like(players.positionsEligible, '%LF%'),
      like(players.positionsEligible, '%CF%'),
      like(players.positionsEligible, '%RF%'),
      like(players.positionsEligible, '%OF%'),
    );
  } else {
    posFilter = or(
      eq(players.primaryPosition, pos),
      like(players.positionsEligible, `%${pos}%`),
    );
  }

  const rows = await db.select({
    playerId: players.playerId,
    nameFirst: players.nameFirst,
    nameLast: players.nameLast,
    year: players.year,
    team: players.team,
    zScore: players.zScorePosition,
  })
    .from(players)
    .where(posFilter!)
    .orderBy(desc(players.zScorePosition))
    .limit(limit);

  return JSON.stringify(rows.map(r => ({
    playerId: r.playerId,
    name: `${r.nameFirst} ${r.nameLast}`,
    year: r.year,
    team: r.team,
    zScore: Number(r.zScore),
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

async function executeSubmitChallenge(args: Record<string, unknown>): Promise<{ challengeId: number } | { error: string }> {
  const theme = String(args.theme);
  const rounds = args.rounds as SubmitRound[];

  // Validate structure
  if (!rounds || rounds.length !== 10) return { error: 'Exactly 10 rounds required' };

  const usedPositions = new Set(rounds.map(r => r.position));
  const requiredPositions = new Set(POSITIONS);
  for (const pos of requiredPositions) {
    if (!usedPositions.has(pos)) return { error: `Missing position: ${pos}` };
  }

  const allPlayerYears = new Set<string>();
  for (const round of rounds) {
    if (round.players.length !== 3) return { error: `Round ${round.position} must have 3 players` };
    for (const p of round.players) {
      if (p.years.length !== 3) return { error: `Player ${p.playerName} must have 3 year options` };
      for (const year of p.years) {
        const key = `${p.playerId}-${year}`;
        if (allPlayerYears.has(key)) return { error: `Duplicate player-year: ${p.playerName} ${year}` };
        allPlayerYears.add(key);
      }
    }
  }

  // Verify all player-years exist in DB
  for (const round of rounds) {
    for (const p of round.players) {
      for (const year of p.years) {
        const [exists] = await db.select({ id: players.id })
          .from(players)
          .where(and(eq(players.playerId, p.playerId), eq(players.year, year)))
          .limit(1);
        if (!exists) return { error: `Player-year not found: ${p.playerName} ${year} (${p.playerId})` };
      }
    }
  }

  // Insert challenge
  const [challenge] = await db.insert(challenges).values({
    challengeDate: `draft-${Date.now()}`,
    positionOrder: rounds.map(r => r.position),
    status: 'draft',
    theme,
  }).returning();

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
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

Your job: Create a 10-round draft challenge based on the user's prompt.

Each challenge has:
- A theme name (2-6 words, creative and catchy)
- 10 rounds, one per position: C, 1B, 2B, SS, 3B, OF, UTIL, SP, RP, P (any order)
- Each round has 3 players, each with 3 year options

Guidelines:
- Pick interesting, diverse players that fit the theme
- Each player needs 3 year options from their career (variety in quality is good)
- Verify players exist by searching before submitting
- For batters: use C, 1B, 2B, SS, 3B, OF, UTIL positions
- For pitchers: use SP, RP, P positions
- UTIL can be any batter. P can be any pitcher.
- All player-years must exist in the database (1961-2025)
- No duplicate player-year combinations across the entire challenge

Process:
1. Think about what theme the prompt suggests
2. Search for relevant players using the tools
3. Build out all 10 rounds
4. Submit the final challenge

Work efficiently — search broadly, then select the best fits.`;

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
      max_output_tokens: 8192,
    });

    let iterations = 0;
    const maxIterations = 20;

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
          result = await executeSearchPlayers(args);
        } else if (toolCall.name === 'get_player_seasons') {
          result = await executeGetPlayerSeasons(args);
        } else if (toolCall.name === 'get_position_leaders') {
          result = await executeGetPositionLeaders(args);
        } else if (toolCall.name === 'submit_challenge') {
          const submitResult = await executeSubmitChallenge(args);
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
        max_output_tokens: 8192,
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
