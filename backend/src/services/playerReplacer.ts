import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
import type { Response as SSEResponse } from 'express';
import { db } from '../db/index.js';
import { players, roundOptions, challengeRounds, portraits } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { calculateSandlotScore } from './sandlotScore.js';
import { toNum } from '../lib/numeric.js';
import {
  executeGetPlayerSeasons,
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
    name: 'get_player_seasons',
    strict: false,
    description: `Fetch full season-by-season data for specific players. Look up by player IDs or name.

Returns all seasons for each matched player with: playerId, name, playerType, position, positions, totalSeasons, and years[] (year, team, zScore, sandlotScore, stats).`,
    parameters: {
      type: 'object',
      properties: {
        playerIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lahman player IDs (e.g. ["troutmi01"]). Up to 20.',
        },
        firstName: { type: 'string', description: 'First name partial match (case-insensitive)' },
        lastName: { type: 'string', description: 'Last name partial match (case-insensitive)' },
        limit: { type: 'number', description: 'Max players to return (default 10, max 20)' },
      },
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
    // Ensure portraits table entry exists
    await db.insert(portraits)
      .values({ playerId, validated: false, portraitUrl })
      .onConflictDoNothing();
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
2. Use get_player_seasons to find candidates by name. The replacement MUST be eligible for position: ${currentPlayer.position}.
3. When you find a good candidate, call suggest_replacement with the playerId, playerName, exactly 3 years, and a brief reasoning.
4. The user will see your suggestion with Sandlot Scores. They can confirm or ask for changes.

RULES:
- The replacement must be eligible for position ${currentPlayer.position}.
- Each player needs 3+ qualifying seasons in the database.
- Pick 3 interesting years: ideally a strong season, a mid-range one, and a weaker one for variety.
- Do NOT suggest players already in this round: ${otherNames}
- Be concise in your messages. This is a quick replacement, not a full challenge build.

POSITION NOTES:
- If position is UTIL: any batter qualifies. Search with playerType="batter", not position="UTIL".
- If position is P: any pitcher qualifies. Search with playerType="pitcher", not position="P".
- For all other positions: search with the specific position code.

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

        if (toolCall.name === 'get_player_seasons') {
          result = await executeGetPlayerSeasons(args);
          const parsed = JSON.parse(result);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const names = parsed.slice(0, 5).map((p: { name: string }) => p.name).join(', ');
            const suffix = parsed.length > 5 ? `, +${parsed.length - 5} more` : '';
            send({ type: 'thinking', message: `Loaded ${parsed.length} player(s): ${names}${suffix}` });
          } else if (parsed.error) {
            send({ type: 'thinking', message: `Error: ${parsed.error}` });
          } else {
            send({ type: 'thinking', message: 'No players found.' });
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
