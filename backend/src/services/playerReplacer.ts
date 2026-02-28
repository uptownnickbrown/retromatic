import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
import type { Response as SSEResponse } from 'express';
import { db } from '../db/index.js';
import { players, roundOptions, challengeRounds } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { calculateSandlotScore } from './sandlotScore.js';
import { toNum } from '../lib/numeric.js';
import {
  executeFindEligiblePlayers,
  executeLookupPlayer,
  getTeamCodesForPrompt,
} from './agentChallengeBuilder.js';
import { generateBlurbsForOption } from './challengeBlurbs.js';
import { generatePortraitForOption, getPortraitPath } from './portraitGenerator.js';
import fs from 'fs';

// Lazy-load OpenAI client
let openai: OpenAI | null = null;
function getClient(): OpenAI {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// ─── Session store for replacement conversations ──────────────
interface ReplacerSession {
  responseId: string;
  optionId: number;
  createdAt: number;
}

const replacerSessions = new Map<string, ReplacerSession>();

function cleanupSessions() {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, session] of replacerSessions) {
    if (session.createdAt < cutoff) replacerSessions.delete(id);
  }
}

// ─── Tool definitions ──────────────────────────────────────────

const replacerTools: OpenAI.Responses.Tool[] = [
  {
    type: 'function' as const,
    name: 'search_players',
    strict: false,
    description: `Search for players eligible for the challenge. Filters find matching players, then returns ALL qualifying seasons for each player (not just seasons matching the filter). Only returns players with 3+ total qualifying seasons.

Each result includes: playerId, name, position, positions (all eligible), playerType, totalSeasons, and years[] (ALL qualifying years with year/team/zScore).`,
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
        minSeasons: { type: 'number', description: 'Minimum total qualifying seasons (default 3, minimum 3).' },
        minZScore: { type: 'number', description: 'Min z-score. Reference: z≈7.3 = Sandlot Score 8, z≈9.3 = Score 9.5+' },
        maxZScore: { type: 'number', description: 'Max z-score.' },
        statFilter: {
          type: 'object',
          description: 'Filter by a raw stat. Batters: R, HR, RBI, SB, H, AB, AVG, BB. Pitchers: W, SV, K, ERA, WHIP, IP, G, GS.',
          properties: {
            stat: { type: 'string' },
            min: { type: 'number' },
            max: { type: 'number' },
          },
          required: ['stat'],
        },
        excludePlayerIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Player IDs to exclude from results',
        },
        limit: { type: 'number', description: 'Max players to return (default 15)' },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'lookup_player',
    strict: false,
    description: `Quick lookup to verify a specific player exists in the database. Returns matching players with their IDs, positions, and season counts.`,
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
    name: 'suggest_replacement',
    strict: false,
    description: `Propose a replacement player. Call this ONCE you've found the right player. The user will see the player with their Sandlot Scores and can confirm or ask for a different suggestion. You MUST pick exactly 3 years from the player's available seasons.`,
    parameters: {
      type: 'object',
      properties: {
        playerId: { type: 'string', description: 'Lahman player_id' },
        playerName: { type: 'string', description: 'Display name (First Last)' },
        years: {
          type: 'array',
          items: { type: 'number' },
          description: 'Exactly 3 year options to use',
          minItems: 3,
          maxItems: 3,
        },
        reasoning: { type: 'string', description: 'Brief explanation of why this player is a good replacement' },
      },
      required: ['playerId', 'playerName', 'years', 'reasoning'],
    },
  },
];

// ─── Suggestion enrichment ────────────────────────────────────

interface SuggestionYearScore {
  year: number;
  team: string;
  zScore: number;
  sandlotScore: number;
}

export interface ReplacementSuggestion {
  playerId: string;
  playerName: string;
  years: SuggestionYearScore[];
  reasoning: string;
  hasExistingPortrait: boolean;
}

async function enrichSuggestion(
  args: { playerId: string; playerName: string; years: number[]; reasoning: string },
): Promise<ReplacementSuggestion | { error: string }> {
  if (args.years.length !== 3) {
    return { error: `Must provide exactly 3 years (got ${args.years.length})` };
  }

  // Verify all years exist in DB
  const yearScores: SuggestionYearScore[] = [];
  const missing: number[] = [];

  for (const year of args.years) {
    const [record] = await db.select({
      year: players.year,
      team: players.team,
      zScore: players.zScorePosition,
    })
      .from(players)
      .where(and(eq(players.playerId, args.playerId), eq(players.year, year)))
      .limit(1);

    if (!record) {
      missing.push(year);
    } else {
      const z = toNum(record.zScore);
      yearScores.push({
        year: record.year,
        team: record.team ?? '',
        zScore: Math.round(z * 100) / 100,
        sandlotScore: calculateSandlotScore(z),
      });
    }
  }

  if (missing.length > 0) {
    // Fetch actual available years for better error message
    const available = await db.select({ year: players.year })
      .from(players)
      .where(eq(players.playerId, args.playerId))
      .orderBy(players.year);
    return {
      error: `Years ${missing.join(', ')} not in DB for ${args.playerName} (${args.playerId}). Available: [${available.map(r => r.year).join(', ')}]`,
    };
  }

  const hasExistingPortrait = fs.existsSync(getPortraitPath(args.playerId));

  return {
    playerId: args.playerId,
    playerName: args.playerName,
    years: yearScores,
    reasoning: args.reasoning,
    hasExistingPortrait,
  };
}

// ─── Confirm replacement ──────────────────────────────────────

export interface ReplacementResult {
  option: { id: number; playerId: string; playerName: string; yearOptions: number[] };
  blurbs: { generated: number; failed: number };
  portrait: { generated: boolean; skipped: boolean; portraitUrl: string | null };
}

export async function confirmReplacement(
  optionId: number,
  playerId: string,
  playerName: string,
  yearOptions: number[],
): Promise<ReplacementResult> {
  // Validate the option exists
  const [option] = await db.select()
    .from(roundOptions)
    .where(eq(roundOptions.id, optionId))
    .limit(1);

  if (!option) throw new Error('Round option not found');

  // Validate all player-years exist
  for (const year of yearOptions) {
    const [exists] = await db.select({ id: players.id })
      .from(players)
      .where(and(eq(players.playerId, playerId), eq(players.year, year)))
      .limit(1);
    if (!exists) throw new Error(`Player-year ${playerId}/${year} not found in database`);
  }

  // Update the round option
  await db.update(roundOptions)
    .set({
      playerId,
      playerName,
      yearOptions,
      blurbs: null,
      portraitUrl: null,
    })
    .where(eq(roundOptions.id, optionId));

  // Generate blurbs
  let blurbResult: { generated: number; failed: number };
  try {
    blurbResult = await generateBlurbsForOption(optionId);
  } catch (err) {
    console.error(`Blurb generation failed for option ${optionId}:`, err);
    blurbResult = { generated: 0, failed: 3 };
  }

  // Generate portrait only if needed
  let portraitResult: ReplacementResult['portrait'];
  const hasPortrait = fs.existsSync(getPortraitPath(playerId));

  if (hasPortrait) {
    // Portrait exists on disk — just set the URL
    const portraitUrl = `/portraits/${playerId}.webp`;
    await db.update(roundOptions)
      .set({ portraitUrl })
      .where(eq(roundOptions.id, optionId));
    portraitResult = { generated: false, skipped: true, portraitUrl };
  } else {
    try {
      const result = await generatePortraitForOption(optionId);
      portraitResult = { generated: result.generated, skipped: false, portraitUrl: result.portraitUrl };
    } catch (err) {
      console.error(`Portrait generation failed for option ${optionId}:`, err);
      portraitResult = { generated: false, skipped: false, portraitUrl: null };
    }
  }

  return {
    option: { id: optionId, playerId, playerName, yearOptions },
    blurbs: blurbResult,
    portrait: portraitResult,
  };
}

// ─── Streaming helper ─────────────────────────────────────────

async function streamOpenAICall(
  params: {
    model: string;
    instructions: string;
    input: string | OpenAI.Responses.ResponseInputItem[];
    previous_response_id?: string;
    tools: OpenAI.Responses.Tool[];
    tool_choice: 'auto' | 'none';
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

// ─── Main replacement agent ───────────────────────────────────

function buildReplacerPrompt(
  currentPlayer: { playerId: string; playerName: string; yearOptions: number[]; position: string },
  otherPlayersInRound: Array<{ playerId: string; playerName: string }>,
  challengeTheme: string | null,
  teamCodes: string,
): string {
  const otherNames = otherPlayersInRound.map(p => `${p.playerName} (${p.playerId})`).join(', ');

  return `You are a baseball expert helping an admin replace a single player in a Sandlot challenge draft round.

CURRENT PLAYER BEING REPLACED:
- Name: ${currentPlayer.playerName}
- Player ID: ${currentPlayer.playerId}
- Position: ${currentPlayer.position}
- Current year options: ${currentPlayer.yearOptions.join(', ')}

OTHER PLAYERS IN THIS ROUND (do NOT suggest these): ${otherNames}
${challengeTheme ? `\nCHALLENGE THEME: "${challengeTheme}" — try to find a replacement that fits this theme if possible.` : ''}

YOUR TASK:
1. Understand what the user is looking for in a replacement.
2. Use search_players and lookup_player to find candidates. The replacement MUST be eligible for position: ${currentPlayer.position}.
3. When you find a good candidate, call suggest_replacement with the playerId, playerName, exactly 3 years, and a brief reasoning.
4. The user will see your suggestion with Sandlot Scores. They can confirm or ask for changes.

RULES:
- The replacement must be eligible for position ${currentPlayer.position}.
- Each player needs 3+ qualifying seasons in the database.
- Pick 3 interesting years: ideally a strong season, a mid-range one, and a weaker one for variety.
- Do NOT suggest players already in this round: ${otherNames}
- Be concise in your messages. This is a quick replacement, not a full challenge build.

TEAM CODES: ${teamCodes}`;
}

export async function runReplacementAgent(
  optionId: number,
  prompt: string,
  res: SSEResponse,
  sessionId?: string,
): Promise<void> {
  cleanupSessions();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const sid = sessionId || `replace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  send({ type: 'session', sessionId: sid });

  const existingSession = sessionId ? replacerSessions.get(sessionId) : null;

  try {
    // Load the option being replaced
    const [option] = await db.select()
      .from(roundOptions)
      .where(eq(roundOptions.id, optionId))
      .limit(1);

    if (!option) {
      send({ type: 'error', message: 'Round option not found' });
      res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
      res.end();
      return;
    }

    // Get the round info (position + other players)
    const [round] = await db.select()
      .from(challengeRounds)
      .where(eq(challengeRounds.id, option.roundId))
      .limit(1);

    if (!round) {
      send({ type: 'error', message: 'Round not found' });
      res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
      res.end();
      return;
    }

    // Get other players in this round (to exclude them)
    const allOptions = await db.select()
      .from(roundOptions)
      .where(eq(roundOptions.roundId, round.id));

    const otherPlayers = allOptions
      .filter(o => o.id !== optionId)
      .map(o => ({ playerId: o.playerId, playerName: o.playerName }));

    // Get challenge theme
    const { challenges } = await import('../db/schema.js');
    const [challenge] = await db.select({ theme: challenges.theme })
      .from(challenges)
      .where(eq(challenges.id, round.challengeId))
      .limit(1);

    const teamCodes = await getTeamCodesForPrompt();
    const systemPrompt = buildReplacerPrompt(
      {
        playerId: option.playerId,
        playerName: option.playerName,
        yearOptions: option.yearOptions as number[],
        position: round.position,
      },
      otherPlayers,
      challenge?.theme ?? null,
      teamCodes,
    );

    const baseParams = {
      model: 'gpt-5-mini',
      instructions: systemPrompt,
      tools: replacerTools,
      tool_choice: 'auto' as const,
      max_output_tokens: 4096,
    };

    let response: OpenAI.Responses.Response;
    if (existingSession) {
      response = await streamOpenAICall(
        { ...baseParams, previous_response_id: existingSession.responseId, input: prompt },
        send,
      );
    } else {
      send({ type: 'thinking', message: `Finding replacement for ${option.playerName} at ${round.position}...` });
      response = await streamOpenAICall({ ...baseParams, input: prompt }, send);
    }

    let iterations = 0;
    const maxIterations = 20;

    while (iterations < maxIterations) {
      iterations++;

      const toolCalls = response.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call',
      );

      if (toolCalls.length === 0) break;

      const toolResults: OpenAI.Responses.ResponseInputItem[] = [];

      for (const toolCall of toolCalls) {
        const args = JSON.parse(toolCall.arguments);
        send({ type: 'tool_call', tool: toolCall.name, args });

        let result: string;

        if (toolCall.name === 'search_players') {
          result = await executeFindEligiblePlayers(args);
          const parsed = JSON.parse(result);
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
          if (Array.isArray(parsed) && parsed.length > 0) {
            const names = parsed.map((p: { name: string; totalSeasons: number }) => `${p.name} (${p.totalSeasons}s)`).join(', ');
            send({ type: 'thinking', message: `Found: ${names}` });
          } else {
            send({ type: 'thinking', message: `No match for "${args.firstName || ''} ${args.lastName || ''}".` });
          }
        } else if (toolCall.name === 'suggest_replacement') {
          const suggestion = await enrichSuggestion(args);
          if ('error' in suggestion) {
            result = JSON.stringify(suggestion);
            send({ type: 'error_recoverable', message: suggestion.error });
          } else {
            // Send the enriched suggestion to the frontend
            send({ type: 'suggestion', suggestion });

            // Save session for continuation
            replacerSessions.set(sid, { responseId: response.id, optionId, createdAt: Date.now() });

            result = JSON.stringify({
              success: true,
              message: 'Suggestion sent to user. Waiting for confirmation or feedback.',
            });

            toolResults.push({
              type: 'function_call_output',
              call_id: toolCall.call_id,
              output: result,
            });

            // Save updated response
            const client = getClient();
            const updatedResponse = await client.responses.create({
              model: 'gpt-5-mini',
              instructions: systemPrompt,
              previous_response_id: response.id,
              input: toolResults,
              tools: replacerTools,
              tool_choice: 'none',
              max_output_tokens: 256,
            });
            replacerSessions.set(sid, { responseId: updatedResponse.id, optionId, createdAt: Date.now() });

            send({ type: 'awaiting_feedback', sessionId: sid });
            res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
            res.end();
            return;
          }
        } else {
          result = JSON.stringify({ error: `Unknown tool: ${toolCall.name}` });
        }

        toolResults.push({
          type: 'function_call_output',
          call_id: toolCall.call_id,
          output: result,
        });
      }

      // Continue with tool results
      response = await streamOpenAICall(
        { ...baseParams, previous_response_id: response.id, input: toolResults },
        send,
      );
    }

    // Agent finished without a suggestion (asked a clarifying question, etc.)
    replacerSessions.set(sid, { responseId: response.id, optionId, createdAt: Date.now() });
    send({ type: 'awaiting_feedback', sessionId: sid });
  } catch (error) {
    console.error('Replacement agent error:', error);
    send({ type: 'error', message: String(error) });
  }

  res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
  res.end();
}
