#!/usr/bin/env npx tsx
/**
 * AI Builder Test Script
 *
 * Runs a set of challenge prompts through the AI builder, captures the full
 * conversation (tool calls, results, AI reasoning, proposals), auto-approves
 * previews, and saves structured logs for comparison.
 *
 * Usage:
 *   cd backend && npx tsx ../scripts/test-ai-builder.ts
 *   cd backend && npx tsx ../scripts/test-ai-builder.ts --test "Turtles"   # run one test by substring
 *   cd backend && npx tsx ../scripts/test-ai-builder.ts --no-submit        # stop at preview, don't submit
 *
 * Requires:
 *   - Backend running at localhost:3001
 *   - ADMIN_SECRET env var set (or in backend/.env)
 *
 * Output:
 *   - scripts/test-results/<timestamp>/<test-name>.json   (full structured log)
 *   - scripts/test-results/<timestamp>/<test-name>.md     (human-readable summary)
 *   - scripts/test-results/<timestamp>/summary.md         (comparison across all tests)
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

// Load env from backend/.env
config({ path: path.resolve(import.meta.dirname ?? '.', '../backend/.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error('ADMIN_SECRET not set. Set it in backend/.env or as an env var.');
  process.exit(1);
}

// ─── Test cases ──────────────────────────────────────────────

interface TestCase {
  name: string;
  slug: string;
  prompt: string;
}

const TEST_CASES: TestCase[] = [
  {
    name: 'NL Central GOATs',
    slug: 'nl-central-goats',
    prompt: '"NL Central GOATs" - the best players who never left the NL Central in their whole career.',
  },
  {
    name: 'Turtles All The Way Down',
    slug: 'turtles',
    prompt: '"Turtles all the way down" - the best seasons at every position with literally 0 steals. If those seasons are bad, so be it. Each player should have no steals in any of the 3 seasons you pick. For pitchers, minimize K\'s without choosing total garbage seasons.',
  },
  {
    name: 'At Least He Got a Ring',
    slug: 'got-a-ring',
    prompt: '"At least he got a ring…" players on World Series winning teams who were not major contributors to that championship team (their Sandlot Score that year is probably poor). But maybe they are great in other years.',
  },
  {
    name: 'Never Got Over the Hump',
    slug: 'never-won',
    prompt: '"Never got over the hump" - great players who never won a World Series.',
  },
  {
    name: 'WBC Semifinal: Italy vs Venezuela',
    slug: 'wbc-semifinal',
    prompt: '"WBC semifinal!" Italy is playing Venezuela in the WBC finals. Look up their rosters (for 2026) and pick as many of those players as you can. Fill it out with other Italy and Venezuela players. Bias towards recent. Try to make it even between the two countries.',
  },
];

// ─── SSE event types ─────────────────────────────────────────

interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

interface ToolStep {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  thinkingBefore: string;  // AI reasoning text before this tool call
  thinkingAfter: string;   // thinking message after tool result
}

interface TestResult {
  testCase: TestCase;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  sessionId: string | null;
  challengeId: number | null;
  theme: string | null;
  toolSteps: ToolStep[];
  proposal: unknown | null;
  evalReport: unknown | null;
  errors: string[];
  totalIterations: number;
  rawEvents: SSEEvent[];
}

// ─── SSE stream parser ──────────────────────────────────────

async function consumeSSEStream(
  response: Response,
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6)) as SSEEvent;
          events.push(event);
        } catch {
          // skip malformed events
        }
      }
    }
  }

  return events;
}

// ─── API calls ───────────────────────────────────────────────

async function startBuilder(prompt: string): Promise<SSEEvent[]> {
  const res = await fetch(`${API_BASE}/admin/challenges/generate-agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': ADMIN_SECRET!,
    },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return consumeSSEStream(res);
}

async function continueBuilder(sessionId: string, message: string): Promise<SSEEvent[]> {
  const res = await fetch(`${API_BASE}/admin/challenges/generate-agent/continue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': ADMIN_SECRET!,
    },
    body: JSON.stringify({ sessionId, message }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return consumeSSEStream(res);
}

// ─── Event processing ────────────────────────────────────────

function processEvents(allEvents: SSEEvent[]): {
  sessionId: string | null;
  challengeId: number | null;
  theme: string | null;
  toolSteps: ToolStep[];
  proposal: unknown | null;
  evalReport: unknown | null;
  errors: string[];
  awaitingFeedback: boolean;
} {
  let sessionId: string | null = null;
  let challengeId: number | null = null;
  let theme: string | null = null;
  let proposal: unknown | null = null;
  let evalReport: unknown | null = null;
  const toolSteps: ToolStep[] = [];
  const errors: string[] = [];
  let awaitingFeedback = false;

  let currentText = '';
  let pendingToolCall: { tool: string; args: Record<string, unknown>; thinkingBefore: string } | null = null;

  for (const event of allEvents) {
    switch (event.type) {
      case 'session':
        sessionId = event.sessionId as string;
        break;
      case 'theme':
        theme = (event.title as string) || theme;
        break;
      case 'message_delta':
        currentText += event.delta as string;
        break;
      case 'tool_call': {
        // Save any accumulated text as "thinking before" this tool call
        const thinkingBefore = currentText.trim();
        currentText = '';
        pendingToolCall = {
          tool: event.tool as string,
          args: (event.args as Record<string, unknown>) || {},
          thinkingBefore,
        };
        break;
      }
      case 'tool_result': {
        if (pendingToolCall) {
          const step: ToolStep = {
            ...pendingToolCall,
            result: event.result,
            thinkingAfter: '',
          };
          // Capture eval reports specifically
          if (event.tool === 'evaluate_challenge') {
            evalReport = event.result;
          }
          toolSteps.push(step);
          pendingToolCall = null;
        }
        break;
      }
      case 'thinking': {
        // Attach to the most recent tool step as "thinkingAfter"
        if (toolSteps.length > 0 && !toolSteps[toolSteps.length - 1].thinkingAfter) {
          toolSteps[toolSteps.length - 1].thinkingAfter = event.message as string;
        }
        break;
      }
      case 'proposal':
        proposal = event.proposal;
        break;
      case 'success':
        challengeId = event.challengeId as number;
        break;
      case 'error':
      case 'error_recoverable':
        errors.push(event.message as string);
        break;
      case 'awaiting_feedback':
        awaitingFeedback = true;
        if (event.sessionId) sessionId = event.sessionId as string;
        break;
    }
  }

  return { sessionId, challengeId, theme, toolSteps, proposal, evalReport, errors, awaitingFeedback };
}

// ─── Markdown report generation ──────────────────────────────

function generateReport(result: TestResult): string {
  const lines: string[] = [];
  lines.push(`# ${result.testCase.name}`);
  lines.push('');
  lines.push(`**Prompt:** ${result.testCase.prompt}`);
  lines.push(`**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`);
  lines.push(`**Tool calls:** ${result.toolSteps.length}`);
  lines.push(`**Theme:** ${result.theme || 'N/A'}`);
  lines.push(`**Challenge ID:** ${result.challengeId || 'N/A'}`);
  if (result.errors.length > 0) {
    lines.push(`**Errors:** ${result.errors.join('; ')}`);
  }
  lines.push('');

  // Tool call trace
  lines.push('## Tool Call Trace');
  lines.push('');
  for (let i = 0; i < result.toolSteps.length; i++) {
    const step = result.toolSteps[i];
    lines.push(`### Step ${i + 1}: ${step.tool}`);
    if (step.thinkingBefore) {
      lines.push('');
      lines.push('**AI reasoning:**');
      // Truncate long reasoning
      const reasoning = step.thinkingBefore.length > 500
        ? step.thinkingBefore.slice(0, 500) + '...'
        : step.thinkingBefore;
      lines.push(`> ${reasoning.replace(/\n/g, '\n> ')}`);
    }
    lines.push('');

    if (step.tool === 'query_players') {
      lines.push('**SQL:**');
      lines.push('```sql');
      lines.push(String((step.args as Record<string, unknown>).sql || ''));
      lines.push('```');
      const res = step.result as Record<string, unknown>;
      lines.push(`**Result:** ${res?.rowCount ?? '?'} rows`);
    } else if (step.tool === 'get_player_seasons') {
      const ids = step.args.playerIds as string[] | undefined;
      const name = [step.args.firstName, step.args.lastName].filter(Boolean).join(' ');
      lines.push(`**Lookup:** ${ids ? `IDs: ${ids.join(', ')}` : `Name: ${name}`}`);
      const res = step.result as Array<{ name: string; totalSeasons: number }>;
      if (Array.isArray(res)) {
        lines.push(`**Found:** ${res.map(p => `${p.name} (${p.totalSeasons}s)`).join(', ')}`);
      }
    } else if (step.tool === 'evaluate_challenge') {
      const res = step.result as Record<string, unknown>;
      const overall = res?.overall as Record<string, unknown>;
      lines.push(`**Max possible:** ${overall?.maxPossibleTotal}`);
      lines.push(`**Weak rounds:** ${JSON.stringify(overall?.weakRounds)}`);
      const violations = res?.statViolations as unknown[];
      if (violations?.length) {
        lines.push(`**Stat violations (${violations.length}):**`);
        for (const v of violations.slice(0, 5) as Record<string, unknown>[]) {
          lines.push(`  - ${v.player} ${v.year}: ${v.stat}=${v.actual} (${v.constraint})`);
        }
        if (violations.length > 5) lines.push(`  - ...and ${violations.length - 5} more`);
      }
      const funFlags = res?.funFlags as string[];
      if (funFlags?.length) {
        lines.push(`**Fun flags:** ${funFlags.join('; ')}`);
      }
    } else if (step.tool === 'preview_challenge' || step.tool === 'submit_challenge') {
      lines.push(`**Theme:** ${(step.args as Record<string, unknown>).theme}`);
      const rounds = (step.args as Record<string, unknown>).rounds as Array<Record<string, unknown>>;
      if (rounds) {
        lines.push(`**Rounds:** ${rounds.length}`);
      }
    }

    if (step.thinkingAfter) {
      lines.push(`**Status:** ${step.thinkingAfter}`);
    }
    lines.push('');
  }

  // Proposal summary
  if (result.proposal) {
    lines.push('## Final Proposal');
    lines.push('');
    const prop = result.proposal as { theme: string; rounds: Array<{ position: string; players: Array<{ playerName: string; years: Array<{ year: number; sandlotScore: number }> }> }> };
    lines.push(`| Position | Player 1 | Player 2 | Player 3 | Best Score |`);
    lines.push(`|----------|----------|----------|----------|------------|`);
    for (const round of (prop.rounds || [])) {
      const players = round.players || [];
      const names = players.map((p: { playerName: string }) => p.playerName).slice(0, 3);
      while (names.length < 3) names.push('—');
      const bestScore = Math.max(
        ...players.flatMap((p: { years: Array<{ sandlotScore: number }> }) =>
          (p.years || []).map((y: { sandlotScore: number }) => y.sandlotScore)
        ),
        0,
      );
      lines.push(`| ${round.position} | ${names[0]} | ${names[1]} | ${names[2]} | ${bestScore.toFixed(1)} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateSummary(results: TestResult[]): string {
  const lines: string[] = [];
  lines.push('# AI Builder Test Results Summary');
  lines.push('');
  lines.push(`**Run at:** ${new Date().toISOString()}`);
  lines.push(`**Tests:** ${results.length}`);
  lines.push('');

  lines.push('| Test | Duration | Tools | Eval Violations | Max Score | Challenge ID | Errors |');
  lines.push('|------|----------|-------|-----------------|-----------|-------------|--------|');
  for (const r of results) {
    const eval_ = r.evalReport as Record<string, unknown> | null;
    const overall = eval_?.overall as Record<string, unknown> | undefined;
    const violations = (eval_?.statViolations as unknown[])?.length ?? '—';
    const maxScore = overall?.maxPossibleTotal ?? '—';
    lines.push(
      `| ${r.testCase.name} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.toolSteps.length} | ${violations} | ${maxScore} | ${r.challengeId ?? 'N/A'} | ${r.errors.length} |`
    );
  }
  lines.push('');

  // Tool usage breakdown
  lines.push('## Tool Usage');
  lines.push('');
  for (const r of results) {
    const toolCounts: Record<string, number> = {};
    for (const step of r.toolSteps) {
      toolCounts[step.tool] = (toolCounts[step.tool] || 0) + 1;
    }
    const breakdown = Object.entries(toolCounts).map(([t, c]) => `${t}×${c}`).join(', ');
    lines.push(`- **${r.testCase.name}:** ${breakdown}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────

async function runTest(testCase: TestCase, noSubmit: boolean): Promise<TestResult> {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${testCase.name}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Prompt: ${testCase.prompt.slice(0, 80)}...`);

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  let allEvents: SSEEvent[] = [];
  let totalIterations = 0;

  // Phase 1: Initial build
  console.log('\n→ Starting builder...');
  const events1 = await startBuilder(testCase.prompt);
  allEvents = allEvents.concat(events1);
  totalIterations++;

  let processed = processEvents(allEvents);

  // Log progress
  console.log(`  Tools used: ${processed.toolSteps.map(s => s.tool).join(' → ')}`);
  if (processed.errors.length > 0) {
    console.log(`  ⚠ Errors: ${processed.errors.join('; ')}`);
  }

  // Phase 2: Auto-approve if we got a preview
  if (processed.awaitingFeedback && processed.proposal && processed.sessionId) {
    if (noSubmit) {
      console.log('\n→ Preview received. --no-submit flag set, stopping here.');
    } else {
      console.log('\n→ Preview received, auto-approving...');
      const events2 = await continueBuilder(
        processed.sessionId,
        'The user approved the preview. Call submit_challenge with the exact same lineup.',
      );
      allEvents = allEvents.concat(events2);
      totalIterations++;
      processed = processEvents(allEvents);

      if (processed.challengeId) {
        console.log(`  ✓ Challenge created: ID ${processed.challengeId}`);
      }
    }
  } else if (!processed.proposal) {
    // The AI might still be working (hit iteration limit, or error)
    console.log('\n→ No preview received. Check errors above.');
  }

  const durationMs = Date.now() - startMs;
  console.log(`  Duration: ${(durationMs / 1000).toFixed(1)}s`);

  return {
    testCase,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    sessionId: processed.sessionId,
    challengeId: processed.challengeId,
    theme: processed.theme,
    toolSteps: processed.toolSteps,
    proposal: processed.proposal,
    evalReport: processed.evalReport,
    errors: processed.errors,
    totalIterations,
    rawEvents: allEvents,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const noSubmit = args.includes('--no-submit');
  const testFilter = args.find((a, i) => args[i - 1] === '--test');

  let cases = TEST_CASES;
  if (testFilter) {
    cases = cases.filter(c => c.name.toLowerCase().includes(testFilter.toLowerCase()));
    if (cases.length === 0) {
      console.error(`No test matches "${testFilter}". Available: ${TEST_CASES.map(t => t.name).join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`Running ${cases.length} test(s)${noSubmit ? ' (no-submit mode)' : ''}...`);

  // Create output directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.resolve(import.meta.dirname ?? '.', `test-results/${timestamp}`);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Output: ${outDir}`);

  const results: TestResult[] = [];

  for (const testCase of cases) {
    try {
      const result = await runTest(testCase, noSubmit);
      results.push(result);

      // Save full JSON log
      fs.writeFileSync(
        path.join(outDir, `${testCase.slug}.json`),
        JSON.stringify(result, null, 2),
      );

      // Save markdown report
      fs.writeFileSync(
        path.join(outDir, `${testCase.slug}.md`),
        generateReport(result),
      );
    } catch (error) {
      console.error(`\n✗ ${testCase.name} FAILED: ${error}`);
      results.push({
        testCase,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        sessionId: null,
        challengeId: null,
        theme: null,
        toolSteps: [],
        proposal: null,
        evalReport: null,
        errors: [String(error)],
        totalIterations: 0,
        rawEvents: [],
      });
    }
  }

  // Save summary
  const summary = generateSummary(results);
  fs.writeFileSync(path.join(outDir, 'summary.md'), summary);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(summary);
  console.log(`\nFull results saved to: ${outDir}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
