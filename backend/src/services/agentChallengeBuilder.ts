import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
import type { Response as SSEResponse } from 'express';
import { db, executeRawReadOnlyQuery } from '../db/index.js';
import { players, challenges, challengeRounds, roundOptions } from '../db/schema.js';
import { eq, and, desc, ilike, sql, inArray } from 'drizzle-orm';
import { queueChallenges } from './challengeGenerator.js';
import { calculateSandlotScore } from './sandlotScore.js';
import { lookupCachedPortraits } from './portraitGenerator.js';
import { toNum } from '../lib/numeric.js';

const AGENT_MODEL = 'gpt-5';

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
  themeDescription: string | null;
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
    name: 'get_player_seasons',
    strict: false,
    description: `Fetch full season-by-season data for specific players. Use this AFTER discovering candidates via query_players SQL, or to look up a specific player by name.

Returns all seasons for each matched player with: playerId, name, playerType, position, positions, totalSeasons, and years[] (year, team, zScore, sandlotScore, stats).

This is NOT a discovery tool — use query_players SQL for bulk discovery. Use this to:
- Get full season data for players found via SQL (pass their playerIds)
- Look up a specific player by name (e.g. from web search results or your own knowledge)
- Check what years are available for a player during iteration`,
    parameters: {
      type: 'object',
      properties: {
        playerIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lahman player IDs (e.g. ["troutmi01", "bondsba01"]). Up to 20.',
        },
        firstName: {
          type: 'string',
          description: 'First name partial match (case-insensitive). Use with or without lastName.',
        },
        lastName: {
          type: 'string',
          description: 'Last name partial match (case-insensitive).',
        },
        limit: {
          type: 'number',
          description: 'Max players to return (default 10, max 20).',
        },
      },
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
  {
    type: 'function' as const,
    name: 'query_players',
    strict: false,
    description: `Run a read-only SQL SELECT query against the players table. This is your PRIMARY discovery tool — use it to find candidates across all positions in one shot. Supports career-relative constraints, window functions, cross-season comparisons, JSONB stat extraction, aggregation, and more.

The players table has ~36,500 rows (one per player-season, 1961-2025). Columns:
- player_id (varchar) — Lahman ID, stable across seasons (e.g. "troutmi01")
- name_first, name_last (varchar)
- year (integer) — season year
- team (varchar) — 3-letter code (NYA, BOS, LAN, etc.)
- player_type (varchar) — 'batter' or 'pitcher'
- primary_position (varchar) — C, 1B, 2B, SS, 3B, OF, SP, RP, UTIL
- positions_eligible (varchar) — comma-separated, e.g. "SS,2B,OF"
- stats (jsonb) — raw stats. Access with: (stats->>'HR')::int, (stats->>'ERA')::numeric, etc.
  Batter keys: R, HR, RBI, SB, H, AB, AVG, BB. Pitcher keys: W, SV, K, ERA, WHIP, IP, G, GS.
- z_score_overall (decimal) — overall z-score
- z_score_position (decimal) — position-relative z-score, THE key metric for Sandlot Score
- category_zscores (jsonb) — individual stat z-scores

z_score_position → Sandlot Score: score = 1.0 + ((clamp(z, -2, 10) + 2) / 12) * 9.0
Key thresholds (use z values in queries, not Sandlot Scores):
  z ≈ 3.33 → Score 5.0 | z ≈ 6.0 → Score 7.0 | z ≈ 7.33 → Score 8.0 | z ≈ 9.33 → Score 9.5

IMPORTANT: sandlot_score is NOT a database column — do NOT use it in SQL queries. It is auto-computed and appended to your results for any row that includes z_score_position. Just SELECT z_score_position and you will see sandlot_score in the response.

Rules: SELECT only. Only the "players" table. Always include LIMIT (max 200). 10-second timeout.`,
    parameters: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'A SELECT query against the players table. Must include LIMIT (max 200).',
        },
        explanation: {
          type: 'string',
          description: 'Brief explanation of what this query is looking for.',
        },
      },
      required: ['sql', 'explanation'],
    },
  },
  {
    type: 'function' as const,
    name: 'evaluate_challenge',
    strict: false,
    description: `Evaluate a draft challenge BEFORE showing it to the user. Returns quality metrics, stat constraint violations, and actionable feedback. You MUST call this before preview_challenge.

Checks:
- Per-round quality: best/worst Sandlot Score, score spread
- Overall: max possible total, weak rounds (best < 8.0), dead rounds (best < 5.0)
- Stat constraint violations: flags player-years that break your theme's stat rules
- Validation: player-years exist, position types correct, completeness
- Fun factor: flags too-uniform rounds or unplayable rounds

Use statConstraints to enforce theme rules. Example for "0 steals": [{stat:"SB", max:0, applyTo:"all_batter_years"}]`,
    parameters: {
      type: 'object',
      properties: {
        theme: { type: 'string', description: 'Challenge theme name' },
        rounds: challengeParamsSchema.properties.rounds,
        statConstraints: {
          type: 'array',
          description: 'Optional stat constraints to validate against. Each checks a stat for all player-years of the specified type.',
          items: {
            type: 'object',
            properties: {
              stat: { type: 'string', description: 'Stat key (HR, SB, AVG, ERA, W, K, etc.)' },
              min: { type: 'number', description: 'Minimum value (inclusive)' },
              max: { type: 'number', description: 'Maximum value (inclusive)' },
              applyTo: {
                type: 'string',
                enum: ['all_batter_years', 'all_pitcher_years', 'all_years'],
                description: 'Which player-years to check',
              },
            },
            required: ['stat', 'applyTo'],
          },
        },
      },
      required: ['theme', 'rounds'],
    },
  },
  { type: 'web_search' as const },
];

// ─── Tool execution ──────────────────────────────────────────

export async function executeGetPlayerSeasons(args: Record<string, unknown>): Promise<string> {
  const inputIds = Array.isArray(args.playerIds) ? (args.playerIds as string[]).slice(0, 20) : [];
  const firstName = args.firstName ? String(args.firstName) : null;
  const lastName = args.lastName ? String(args.lastName) : null;
  const limit = Math.min(Number(args.limit) || 10, 20);

  // Determine which player IDs to fetch
  let targetIds: string[];

  if (inputIds.length > 0) {
    targetIds = inputIds;
  } else if (firstName || lastName) {
    // Name lookup: find matching player IDs
    const nameConditions = [];
    if (lastName) nameConditions.push(ilike(players.nameLast, `%${lastName}%`));
    if (firstName) nameConditions.push(ilike(players.nameFirst, `%${firstName}%`));

    const nameRows = await db.select({
      playerId: players.playerId,
      bestZ: sql<string>`MAX(${players.zScorePosition}::numeric)`,
    })
      .from(players)
      .where(and(...nameConditions))
      .groupBy(players.playerId)
      .orderBy(desc(sql`MAX(${players.zScorePosition}::numeric)`))
      .limit(limit);

    targetIds = nameRows.map(r => r.playerId);
  } else {
    return JSON.stringify({ error: 'Provide playerIds or firstName/lastName' });
  }

  if (targetIds.length === 0) return JSON.stringify([]);

  // Fetch ALL seasons for these players
  const allRows = await db.select({
    playerId: players.playerId,
    nameFirst: players.nameFirst,
    nameLast: players.nameLast,
    year: players.year,
    team: players.team,
    position: players.primaryPosition,
    positionsEligible: players.positionsEligible,
    playerType: players.playerType,
    zScore: players.zScorePosition,
    stats: players.stats,
  })
    .from(players)
    .where(inArray(players.playerId, targetIds))
    .orderBy(desc(players.zScorePosition));

  // Group by player
  const grouped = new Map<string, {
    playerId: string;
    name: string;
    playerType: string;
    position: string;
    positions: string;
    years: Array<{ year: number; team: string; zScore: number; sandlotScore: number; stats: unknown }>;
  }>();

  for (const r of allRows) {
    const z = toNum(r.zScore);
    const season = {
      year: r.year,
      team: r.team ?? '',
      zScore: Math.round(z * 100) / 100,
      sandlotScore: calculateSandlotScore(z),
      stats: r.stats,
    };

    const existing = grouped.get(r.playerId);
    if (existing) {
      existing.years.push(season);
    } else {
      grouped.set(r.playerId, {
        playerId: r.playerId,
        name: `${r.nameFirst} ${r.nameLast}`,
        playerType: r.playerType,
        position: r.position,
        positions: r.positionsEligible || r.position,
        years: [season],
      });
    }
  }

  // Return in the order requested (by ID) or by best z-score (by name)
  const results = Array.from(grouped.values()).map(p => ({
    ...p,
    totalSeasons: p.years.length,
  }));

  return JSON.stringify(results);
}

// ─── Challenge evaluation ────────────────────────────────────

interface StatConstraint {
  stat: string;
  min?: number;
  max?: number;
  applyTo: string;
}

async function executeEvaluateChallenge(args: Record<string, unknown>): Promise<string> {
  const aiRounds = (args.rounds as SubmitRound[]) || [];
  const statConstraints = (args.statConstraints as StatConstraint[]) || [];

  const roundEvals: Array<{
    position: string;
    playerCount: number;
    bestScore: number;
    worstScore: number;
    scoreRange: number;
    players: Array<{ name: string; bestYear: number; bestScore: number }>;
  }> = [];

  const statViolations: Array<{
    player: string;
    year: number;
    position: string;
    stat: string;
    actual: number;
    constraint: string;
  }> = [];

  const validationErrors: string[] = [];
  const funFlags: string[] = [];

  // Collect all player-year pairs
  const playerYearPairs: Array<{ playerId: string; year: number; playerName: string; position: string }> = [];
  for (const round of aiRounds) {
    for (const p of round.players) {
      for (const year of p.years) {
        playerYearPairs.push({ playerId: p.playerId, year, playerName: p.playerName, position: round.position });
      }
    }
  }

  // Batch fetch all player-year data
  const dataMap = new Map<string, { z: number; score: number; stats: Record<string, unknown>; playerType: string }>();
  if (playerYearPairs.length > 0) {
    const whereClauses = playerYearPairs.map(
      p => sql`(${players.playerId} = ${p.playerId} AND ${players.year} = ${p.year})`
    );
    const records = await db.select({
      playerId: players.playerId,
      year: players.year,
      zScorePosition: players.zScorePosition,
      stats: players.stats,
      playerType: players.playerType,
    }).from(players).where(sql.join(whereClauses, sql` OR `));

    for (const r of records) {
      const z = toNum(r.zScorePosition);
      dataMap.set(`${r.playerId}-${r.year}`, {
        z,
        score: calculateSandlotScore(z),
        stats: (r.stats ?? {}) as Record<string, unknown>,
        playerType: r.playerType,
      });
    }
  }

  // Check for missing player-years
  for (const py of playerYearPairs) {
    if (!dataMap.has(`${py.playerId}-${py.year}`)) {
      validationErrors.push(`${py.playerName} ${py.year} not found in database`);
    }
  }

  // Check position-type correctness
  const PITCHER_POSITIONS = new Set(['SP', 'RP', 'P']);
  for (const round of aiRounds) {
    const isPitcherSlot = PITCHER_POSITIONS.has(round.position);
    for (const p of round.players) {
      const data = dataMap.get(`${p.playerId}-${p.years[0]}`);
      if (data) {
        if (isPitcherSlot && data.playerType !== 'pitcher') {
          validationErrors.push(`${p.playerName} is a ${data.playerType} in pitcher slot ${round.position}`);
        } else if (!isPitcherSlot && data.playerType !== 'batter') {
          validationErrors.push(`${p.playerName} is a ${data.playerType} in batter slot ${round.position}`);
        }
      }
    }
  }

  // Per-round evaluation
  const scoreDistribution = { legendary: 0, elite: 0, allStar: 0, solid: 0, weak: 0 };
  let totalBestScores = 0;
  const weakRounds: string[] = [];
  const deadRounds: string[] = [];

  for (const round of aiRounds) {
    const playerScores: Array<{ name: string; bestYear: number; bestScore: number }> = [];
    let roundBest = 0;
    let roundWorst = 10;

    for (const p of round.players) {
      let pBest = 0;
      let pBestYear = 0;
      for (const year of p.years) {
        const data = dataMap.get(`${p.playerId}-${year}`);
        const score = data?.score ?? 0;
        if (score > pBest) { pBest = score; pBestYear = year; }
        if (score > roundBest) roundBest = score;
        if (score < roundWorst) roundWorst = score;

        if (score >= 9.5) scoreDistribution.legendary++;
        else if (score >= 8.5) scoreDistribution.elite++;
        else if (score >= 7.0) scoreDistribution.allStar++;
        else if (score >= 5.0) scoreDistribution.solid++;
        else scoreDistribution.weak++;
      }
      playerScores.push({ name: p.playerName, bestYear: pBestYear, bestScore: Math.round(pBest * 10) / 10 });
    }

    totalBestScores += roundBest;

    roundEvals.push({
      position: round.position,
      playerCount: round.players.length,
      bestScore: Math.round(roundBest * 10) / 10,
      worstScore: Math.round(roundWorst * 10) / 10,
      scoreRange: Math.round((roundBest - roundWorst) * 10) / 10,
      players: playerScores,
    });

    if (roundBest < 8.0) weakRounds.push(round.position);
    if (roundBest < 5.0) deadRounds.push(round.position);
  }

  // Stat constraint checking
  for (const constraint of statConstraints) {
    for (const py of playerYearPairs) {
      const data = dataMap.get(`${py.playerId}-${py.year}`);
      if (!data) continue;

      if (constraint.applyTo === 'all_batter_years' && data.playerType !== 'batter') continue;
      if (constraint.applyTo === 'all_pitcher_years' && data.playerType !== 'pitcher') continue;

      const statVal = Number(data.stats[constraint.stat] ?? 0);
      let violated = false;
      let constraintDesc = '';
      if (constraint.min != null && statVal < constraint.min) {
        violated = true;
        constraintDesc = `min: ${constraint.min}`;
      }
      if (constraint.max != null && statVal > constraint.max) {
        violated = true;
        constraintDesc = `max: ${constraint.max}`;
      }
      if (violated) {
        statViolations.push({
          player: py.playerName,
          year: py.year,
          position: py.position,
          stat: constraint.stat,
          actual: statVal,
          constraint: constraintDesc,
        });
      }
    }
  }

  // Fun flags
  if (deadRounds.length > 0) {
    funFlags.push(`Rounds with no option above 5.0: ${deadRounds.join(', ')} — these will feel bad to play`);
  }
  for (const re of roundEvals) {
    if (re.playerCount === 3 && re.scoreRange < 1.0 && re.bestScore > 5.0) {
      funFlags.push(`${re.position}: all 3 options very similar (range ${re.scoreRange}) — less interesting for drafting`);
    }
  }

  // Missing positions
  const providedPositions = new Set(aiRounds.map(r => r.position));
  const missing = POSITIONS.filter(p => !providedPositions.has(p));
  if (missing.length > 0) {
    validationErrors.push(`Missing positions: ${missing.join(', ')}`);
  }
  const incomplete = aiRounds.filter(r => r.players.length < 3);
  if (incomplete.length > 0) {
    validationErrors.push(`Incomplete rounds: ${incomplete.map(r => `${r.position} (${r.players.length}/3)`).join(', ')}`);
  }

  return JSON.stringify({
    roundEvals,
    overall: {
      filledPositions: aiRounds.length,
      maxPossibleTotal: Math.round(totalBestScores * 10) / 10,
      weakRounds,
      deadRounds,
      scoreDistribution,
    },
    statViolations,
    validationErrors,
    funFlags,
  });
}

// ─── SQL query validation and execution ──────────────────────

const SQL_FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|EXECUTE|DO\b|CALL|SET|BEGIN|COMMIT|ROLLBACK|LOCK|NOTIFY|LISTEN|VACUUM|ANALYZE|CLUSTER|REINDEX|EXPLAIN)\b/i;
const MAX_QUERY_ROWS = 200;
const QUERY_TIMEOUT_MS = 10_000;

export function validateSqlQuery(query: string): { valid: true } | { valid: false; error: string } {
  if (!query.trim()) {
    return { valid: false, error: 'sql parameter is required' };
  }

  // Must start with SELECT or WITH (CTEs)
  if (!/^\s*(SELECT|WITH)\b/i.test(query)) {
    return { valid: false, error: 'Query must start with SELECT or WITH (CTEs). Only read operations allowed.' };
  }

  // Reject forbidden keywords
  const forbidden = query.match(SQL_FORBIDDEN_KEYWORDS);
  if (forbidden) {
    return { valid: false, error: `Forbidden SQL keyword: ${forbidden[0]}. Only SELECT queries are allowed.` };
  }

  // Only allow querying the players table (check FROM and JOIN targets)
  // First, collect CTE names defined by WITH ... AS so we don't flag them as real tables
  const cteNames = new Set<string>();
  const cteRegex = /\bWITH\b|\b(\w+)\s+AS\s*\(/gi;
  let match;
  while ((match = cteRegex.exec(query)) !== null) {
    if (match[1]) cteNames.add(match[1].toLowerCase());
  }

  const tables: string[] = [];
  const fromRegex = /\bFROM\s+(\w+)/gi;
  const joinRegex = /\bJOIN\s+(\w+)/gi;
  while ((match = fromRegex.exec(query)) !== null) tables.push(match[1].toLowerCase());
  while ((match = joinRegex.exec(query)) !== null) tables.push(match[1].toLowerCase());
  const disallowed = tables.filter(t => t !== 'players' && !cteNames.has(t));
  if (disallowed.length > 0) {
    return { valid: false, error: `Only the "players" table can be queried. Found references to: ${disallowed.join(', ')}` };
  }

  // Must include LIMIT
  if (!/\bLIMIT\b/i.test(query)) {
    return { valid: false, error: 'Query must include a LIMIT clause (max 200).' };
  }

  return { valid: true };
}

export async function executeQueryPlayers(args: Record<string, unknown>): Promise<string> {
  const query = String(args.sql || '').trim();
  const explanation = String(args.explanation || '');

  const validation = validateSqlQuery(query);
  if (!validation.valid) {
    return JSON.stringify({ error: validation.error });
  }

  console.log(JSON.stringify({
    event: 'agent_sql_query',
    explanation,
    queryLength: query.length,
    queryPreview: query.slice(0, 300),
  }));

  try {
    const rows = await executeRawReadOnlyQuery(query, QUERY_TIMEOUT_MS, MAX_QUERY_ROWS);

    // Auto-enrich: compute sandlot_score for rows that have a z-score column
    const enrichedRows = rows.map((row: Record<string, unknown>) => {
      const zRaw = row.z_score_position ?? row.best_z ?? row.z;
      if (zRaw != null) {
        const z = Number(zRaw);
        if (!Number.isNaN(z) && !('sandlot_score' in row)) {
          return { ...row, sandlot_score: calculateSandlotScore(z) };
        }
      }
      return row;
    });

    return JSON.stringify({ rowCount: enrichedRows.length, rows: enrichedRows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({
      event: 'agent_sql_error',
      explanation,
      error: message,
    }));
    return JSON.stringify({
      error: `Query failed: ${message}`,
      hint: 'Check column names (snake_case), JSONB syntax (stats->>\'HR\'), and ensure valid PostgreSQL.',
    });
  }
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

  // Validate position-type eligibility (pitchers in pitcher slots, batters in batter slots)
  const PITCHER_POSITIONS = new Set(['SP', 'RP', 'P']);
  const allPlayerIds = [...new Set(aiRounds.flatMap(r => r.players.map(p => p.playerId)))];
  const playerTypeMap = new Map<string, string>();
  if (allPlayerIds.length > 0) {
    const typeRecords = await db.selectDistinct({
      playerId: players.playerId,
      playerType: players.playerType,
    })
      .from(players)
      .where(inArray(players.playerId, allPlayerIds));
    for (const r of typeRecords) {
      playerTypeMap.set(r.playerId, r.playerType);
    }
  }

  const positionErrors: string[] = [];
  for (const round of aiRounds) {
    const isPitcherSlot = PITCHER_POSITIONS.has(round.position);
    for (const p of round.players) {
      const pType = playerTypeMap.get(p.playerId);
      if (!pType) continue; // already caught by existence check above
      if (isPitcherSlot && pType !== 'pitcher') {
        positionErrors.push(`${p.playerName} (${p.playerId}) is a ${pType} but placed in pitcher position ${round.position}`);
      } else if (!isPitcherSlot && pType !== 'batter') {
        positionErrors.push(`${p.playerName} (${p.playerId}) is a ${pType} but placed in batter position ${round.position}`);
      }
    }
  }

  if (positionErrors.length > 0) {
    return { error: `Position-type mismatch:\n${positionErrors.join('\n')}` };
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

  // Pre-fill cached portrait URLs
  const allPlayerIds = result.finalRounds.flatMap(r => r.players.map(p => p.playerId));
  const cachedPortraits = await lookupCachedPortraits(allPlayerIds);

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
        portraitUrl: cachedPortraits.get(p.playerId) ?? null,
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

Your job: Create a 10-round draft challenge based on the user's prompt. Each challenge has a theme, 10 positions (C, 1B, 2B, SS, 3B, OF, UTIL, SP, RP, P), and 3 players per position with 3 year options each.

## AUTONOMY
- NEVER ask the user clarifying questions unless the prompt is genuinely ambiguous.
- Make creative decisions yourself — you are the baseball expert.
- If a search returns too few results, broaden criteria or try a different angle.
- Pick the most interesting interpretation of ambiguous themes.
- Only pause for user input AFTER presenting a preview via preview_challenge.

## COMMUNICATION
- Before your first action, explain your theme interpretation and strategy in 1-2 sentences.
- After significant discoveries, briefly note progress.
- When presenting a preview, summarize why these players fit the theme.

## EFFICIENCY RULES (MANDATORY)
- NEVER call get_player_seasons by name (firstName/lastName) more than 5 times total in a session. Each name lookup is a separate database round-trip.
- After finding players via SQL or web search, use batch lookups: get_player_seasons({ playerIds: ["benchjo01", "larkiba01", "gibsobo01", ...] })
- For bulk name lookups, use query_players SQL: WHERE name_last IN ('Bench', 'Larkin', 'Gibson') — this finds everyone in ONE call.
- query_players results are auto-enriched with sandlot_score (computed from z_score_position). Do NOT put sandlot_score in your SQL — it is NOT a database column. Just SELECT z_score_position and the score appears in results. You can draft directly from SQL results without calling get_player_seasons.

## THEME CLASSIFICATION — CHOOSE YOUR APPROACH
Before searching, classify the theme and pick the right discovery strategy:

1. **Stat-based** (e.g. "0 steals", "40 HR club", "sub-2 ERA"): Use query_players SQL with stat filters. One broad query can find candidates across ALL positions at once.
2. **Knowledge-based** (e.g. "WBC rosters", "World Series winners", "Hall of Famers", championship history, nationality, award winners): You MUST call web_search FIRST before any database queries. Never rely solely on your training data for factual claims about who won championships, who played for which country, etc. Get the authoritative list from the web, THEN verify players in the database.
3. **Team-based** (e.g. "Angels legends", "90s Braves dynasty"): One SQL query with team filter across all positions.
4. **Subjective** (e.g. "fun characters", "fan favorites"): Brainstorm players from your knowledge, then batch-verify via get_player_seasons.
5. **Career-pattern** (e.g. "late bloomers", "one-hit wonders"): SQL with window functions and career comparisons.
6. **Hybrid**: Combine approaches. E.g. "WS ring but bad season" = web_search for WS winners + SQL for low z-scores on those teams.

## PHASED WORKFLOW

### Phase 1: PLAN
Classify the theme. Decide discovery strategy. Identify stat constraints (if any).

### Phase 2: DISCOVER
- **Write ONE broad SQL query** via query_players that finds candidates across ALL positions. Avoid searching position-by-position.
- For SQL discovery queries, ALWAYS include: player_id, name_first, name_last, year, team, primary_position, positions_eligible, player_type, z_score_position, and any theme-relevant stats. This gives you everything to draft directly from results.
- SQL results are auto-enriched with sandlot_score (do NOT put sandlot_score in your SQL — it's not a DB column). Just include z_score_position in your SELECT and the score appears in results. You can go straight to DRAFT without calling get_player_seasons.
- For knowledge-based themes: use web_search FIRST to get authoritative facts, then ONE SQL query to find matching players.
- For subjective themes: brainstorm a list, then use ONE SQL query with WHERE name_last IN (...) to batch-verify all players at once.

### Phase 3: DRAFT
- Assign candidates to all 10 positions. Choose 3 year options per player.
- Use get_player_seasons if you need to see all available years for specific players.
- NEVER guess years — only use years from tool results.
- Players can cross positions — use positions_eligible to assign flexibly.

### Phase 4: EVALUATE (MANDATORY)
- Call evaluate_challenge with your draft AND any stat constraints.
- Review the report: fix validation errors, stat violations, weak rounds.
- For stat-based themes, use statConstraints to automatically catch violations (e.g. [{stat:"SB", max:0, applyTo:"all_batter_years"}]).
- Also do your own subjective check: does every player genuinely fit the theme?

### Phase 5: ITERATE
- If evaluate found issues, fix them and re-evaluate.
- Use query_players to find replacements, or get_player_seasons to check alternative years.
- Repeat until: 0 validation errors, 0 stat violations, no dead rounds (best < 5.0), max total ≥ 70.

### Phase 6: PREVIEW
- Call preview_challenge to show the user your lineup with Sandlot Scores.
- Wait for approval or feedback.

### Phase 7: SUBMIT
- Only after user approval, call submit_challenge with the same lineup.

## POSITION RULES (STRICT)
- SP, RP, P: pitchers ONLY (player_type = 'pitcher'). Batters will be rejected.
- C, 1B, 2B, SS, 3B, OF, UTIL: batters ONLY (player_type = 'batter').
- UTIL: wildcard batter — ANY batter qualifies. In SQL, filter player_type = 'batter'.
- P: wildcard pitcher — ANY pitcher qualifies. In SQL, filter player_type = 'pitcher'.

## THEME VALIDATION
- CRITICAL: Database matches ≠ theme fit. YOU must verify each player genuinely fits the theme.
- If a search returns 15 players and only 3 genuinely fit, use those 3.

## DRAFT QUALITY TARGETS
- Every round should have at least one player-year with Sandlot Score 8+ (z ≥ 7.3).
- Max possible total score ≥ 70.
- Variety is good: mix great options, mediocre options, and surprise hidden gems. All 3 being identical scores is boring.
- evaluate_challenge enforces these — use it.

## COVERAGE
- You must fill all 10 positions with 3 players each. No auto-fill.
- Think holistically. Spread themed players across positions using positions_eligible.

## EDITING WORKFLOW (when user requests changes)
- ONLY modify the specific rounds/players mentioned.
- Preserve every other round EXACTLY as-is.
- Include ALL rounds (changed + unchanged) in the new preview.

## REFERENCE

POSITIONS: Batters = C, 1B, 2B, SS, 3B, OF, UTIL. Pitchers = SP, RP, P.
DATABASE: 1961-2025, MLB only.
TEAM CODES: ${teamCodes}

## SQL PATTERNS (query_players)

CRITICAL GROUPING RULE: Each row = a player-season. When writing career queries:
- GROUP BY player_id only. NEVER include primary_position, team, or name in GROUP BY.
- Use MAX(name_first), MAX(name_last) for names in aggregated queries.
- Use BOOL_OR(positions_eligible LIKE '%1B%') for position filtering across careers.
- Use STRING_AGG(DISTINCT primary_position, ',') to see all positions played.
- Use STRING_AGG(DISTINCT team, ',') to see all teams played for.

Example: Find all batters with 3+ seasons of exactly 0 SB, sorted by best z-score, with position info:
SELECT player_id, MAX(name_first) as name_first, MAX(name_last) as name_last,
  STRING_AGG(DISTINCT primary_position, ',') as positions,
  COUNT(*) as zero_sb_seasons,
  ROUND(MAX(z_score_position::numeric), 2) as best_z,
  STRING_AGG(DISTINCT team, ',') as teams
FROM players
WHERE player_type = 'batter' AND (stats->>'SB')::int = 0
GROUP BY player_id
HAVING COUNT(*) >= 3
ORDER BY best_z DESC LIMIT 100

Example: Career-only NL Central players (never played elsewhere):
SELECT player_id, MAX(name_first) as name_first, MAX(name_last) as name_last,
  STRING_AGG(DISTINCT primary_position, ',') as positions,
  STRING_AGG(DISTINCT team, ',') as teams,
  COUNT(*) as seasons, ROUND(MAX(z_score_position::numeric), 2) as best_z
FROM players
GROUP BY player_id
HAVING COUNT(DISTINCT CASE WHEN team NOT IN ('PIT','SLN','CHN','CIN','MIL') THEN team END) = 0
  AND COUNT(DISTINCT CASE WHEN team IN ('PIT','SLN','CHN','CIN','MIL') THEN team END) >= 1
  AND COUNT(*) >= 5
ORDER BY best_z DESC LIMIT 100

Example: Late bloomers (mediocre early, great late):
WITH career AS (
  SELECT player_id, z_score_position::numeric as z,
    ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY year) as season_num
  FROM players WHERE player_type = 'batter'
)
SELECT player_id, MAX(name_first) as name_first, MAX(name_last) as name_last,
  COUNT(*) as total_seasons
FROM career JOIN players USING (player_id)
GROUP BY player_id
HAVING COUNT(DISTINCT year) >= 10
  AND MAX(CASE WHEN season_num <= 7 THEN z END) < 3.33
  AND MAX(CASE WHEN season_num >= 8 THEN z END) >= 6.0
ORDER BY MAX(CASE WHEN season_num >= 8 THEN z END) DESC LIMIT 50

Example: Players on a specific team in a specific year with low z-scores (ring-chasers):
SELECT player_id, name_first, name_last, year, team, primary_position, positions_eligible,
  player_type, ROUND(z_score_position::numeric, 2) as z
FROM players
WHERE team = 'NYA' AND year = 1998 AND z_score_position::numeric < 3
ORDER BY z_score_position::numeric ASC LIMIT 50`;
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
  // Store the user's original prompt as theme description for context reinforcement
  const themeDescription = existingSession?.themeDescription ?? (existingSession ? null : prompt.slice(0, 200));

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
      model: AGENT_MODEL,
      instructions: systemPrompt,
      tools,
      tool_choice: 'auto' as const,
      max_output_tokens: 16384,
    };
    let response: OpenAI.Responses.Response;
    if (existingSession) {
      // Prefix continuation with challenge title + description to reinforce context
      const contextPrefix = challengeTitle
        ? `[Continuing work on challenge: "${challengeTitle}"${themeDescription ? ` — ${themeDescription}` : ''}]\n\nUser feedback: `
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
    let serialNameLookups = 0;

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

        // Reset serial name lookup counter on non-get_player_seasons tools
        if (toolCall.name !== 'get_player_seasons') {
          serialNameLookups = 0;
        }

        // Extract challenge title from preview/submit tool calls
        if ((toolCall.name === 'preview_challenge' || toolCall.name === 'submit_challenge') && args.theme && args.theme !== challengeTitle) {
          challengeTitle = args.theme;
          send({ type: 'theme', title: challengeTitle });
        }

        send({ type: 'tool_call', tool: toolCall.name, args });

        let result: string;
        if (toolCall.name === 'get_player_seasons') {
          result = await executeGetPlayerSeasons(args);
          const parsed = JSON.parse(result);
          console.log(JSON.stringify({
            event: 'agent_tool_result',
            sessionId: sid,
            tool: 'get_player_seasons',
            playerCount: Array.isArray(parsed) ? parsed.length : 0,
            resultSize: result.length,
          }));
          if (Array.isArray(parsed) && parsed.length > 0) {
            const names = parsed.slice(0, 5).map((p: { name: string }) => p.name).join(', ');
            const suffix = parsed.length > 5 ? `, +${parsed.length - 5} more` : '';
            send({ type: 'thinking', message: `Loaded ${parsed.length} player(s): ${names}${suffix}` });
          } else if (parsed.error) {
            send({ type: 'thinking', message: `Error: ${parsed.error}` });
          } else {
            send({ type: 'thinking', message: 'No players found.' });
          }

          // Track serial name lookups (name-based, not batch playerIds)
          const isNameLookup = (args.firstName || args.lastName) &&
            !(Array.isArray(args.playerIds) && args.playerIds.length > 0);
          if (isNameLookup) {
            serialNameLookups++;
          } else {
            serialNameLookups = 0;
          }

          // Inject efficiency warnings after repeated name lookups
          if (serialNameLookups >= 15) {
            result += '\n\n🚨 STOP: You have made ' + serialNameLookups + ' individual name lookups. This is extremely inefficient. You MUST switch to batch methods NOW: use get_player_seasons({ playerIds: ["id1", "id2", ...] }) or query_players SQL with WHERE name_last IN (...). Do NOT make any more individual name calls.';
            console.log(JSON.stringify({ event: 'agent_serial_lookup_warning', sessionId: sid, count: serialNameLookups, level: 'critical' }));
            send({ type: 'thinking', message: `Warning: ${serialNameLookups} individual lookups — redirecting to batch mode` });
          } else if (serialNameLookups >= 8) {
            result += '\n\n⚠️ You have called get_player_seasons by name ' + serialNameLookups + ' times. This is inefficient. For remaining players, either: (1) Pass multiple playerIds in a single call, or (2) Use query_players with SQL WHERE name_last IN (...) to find multiple players at once.';
            console.log(JSON.stringify({ event: 'agent_serial_lookup_warning', sessionId: sid, count: serialNameLookups, level: 'warning' }));
            send({ type: 'thinking', message: `Warning: ${serialNameLookups} individual lookups — nudging toward batch mode` });
          }
        } else if (toolCall.name === 'preview_challenge') {
          const previewResult = await executePreviewChallenge(args, send);
          if ('preview' in previewResult) {
            console.log(JSON.stringify({ event: 'agent_preview_sent', sessionId: sid, theme: args.theme }));
            // Save session for continuation
            agentSessions.set(sid, { responseId: response.id, challengeTitle, themeDescription, createdAt: Date.now() });
            // Tell the agent the preview was sent, including quality metrics
            result = JSON.stringify({ success: true, message: `Preview sent to user. ${previewResult.qualitySummary}. Waiting for approval or feedback.` });
            toolResults.push({
              type: 'function_call_output',
              call_id: toolCall.call_id,
              output: result,
            });

            // Save updated response with tool result so we can continue later
            const updatedResponse = await client.responses.create({
              model: AGENT_MODEL,
              instructions: systemPrompt,
              previous_response_id: response.id,
              input: toolResults,
              tools,
              tool_choice: 'none',
              max_output_tokens: 256,
            });
            agentSessions.set(sid, { responseId: updatedResponse.id, challengeTitle, themeDescription, createdAt: Date.now() });

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
        } else if (toolCall.name === 'query_players') {
          result = await executeQueryPlayers(args);
          const parsed = JSON.parse(result);
          console.log(JSON.stringify({
            event: 'agent_tool_result',
            sessionId: sid,
            tool: 'query_players',
            rowCount: parsed.rowCount ?? 0,
            error: parsed.error ?? null,
          }));
          if (parsed.error) {
            send({ type: 'thinking', message: `SQL error: ${parsed.error}` });
          } else {
            send({ type: 'thinking', message: `Query returned ${parsed.rowCount} rows` });
          }
        } else if (toolCall.name === 'evaluate_challenge') {
          result = await executeEvaluateChallenge(args);
          const parsed = JSON.parse(result);
          const violations = parsed.statViolations?.length || 0;
          const errors = parsed.validationErrors?.length || 0;
          const weakCount = parsed.overall?.weakRounds?.length || 0;
          console.log(JSON.stringify({
            event: 'agent_tool_result',
            sessionId: sid,
            tool: 'evaluate_challenge',
            violations,
            errors,
            weakRounds: weakCount,
            maxScore: parsed.overall?.maxPossibleTotal,
          }));
          if (errors > 0) {
            send({ type: 'thinking', message: `Evaluation: ${errors} validation error(s), fixing...` });
          } else if (violations > 0) {
            send({ type: 'thinking', message: `Evaluation: ${violations} stat violation(s), adjusting...` });
          } else if (weakCount > 0) {
            send({ type: 'thinking', message: `Evaluation: ${weakCount} weak round(s), improving...` });
          } else {
            send({ type: 'thinking', message: `Evaluation passed — max score ${parsed.overall?.maxPossibleTotal?.toFixed(1)}` });
          }
        } else {
          result = JSON.stringify({ error: `Unknown tool: ${toolCall.name}` });
        }

        // Send tool result to client for observability (test scripts, debugging)
        send({ type: 'tool_result', tool: toolCall.name, result: JSON.parse(result) });

        // Append theme reminder to tool results to prevent drift over long conversations
        if (themeDescription && challengeTitle) {
          result += `\n\n[Reminder: Building challenge "${challengeTitle}" — ${themeDescription}]`;
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
          model: AGENT_MODEL,
          instructions: systemPrompt,
          previous_response_id: response.id,
          input: toolResults,
          tools,
          tool_choice: 'none',
          max_output_tokens: 256,
        });
        agentSessions.set(sid, { responseId: checkpointResponse.id, challengeTitle, themeDescription, createdAt: Date.now() });

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
    agentSessions.set(sid, { responseId: response.id, challengeTitle, themeDescription, createdAt: Date.now() });

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
