import OpenAI from 'openai';
import { db } from '../db/index.js';
import { players, challengeRounds, roundOptions } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { calculateSandlotScore } from './sandlotScore.js';

// Lazy-load OpenAI client
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

interface PlayerYearInfo {
  playerName: string;
  year: number;
  team: string;
  position: string;
  playerType: string;
  stats: Record<string, number>;
  legendScore: number;
  legendLabel: string;
  careerContext: string;
}

interface CareerSeason {
  year: number;
  team: string;
  legendScore: number;
  stats: Record<string, number>;
}

// Cache career data per playerId to avoid redundant queries
const careerCache = new Map<string, CareerSeason[]>();

function getSandlotLabel(score: number): string {
  if (score >= 9.5) return 'SANDLOT LEGEND';
  if (score >= 8.5) return 'ELITE';
  if (score >= 7.0) return 'ALL-STAR';
  if (score >= 5.0) return 'SOLID';
  if (score >= 3.0) return 'AVERAGE';
  return 'BENCH';
}

// Query all seasons for a player from the DB
async function getCareerContext(playerId: string): Promise<CareerSeason[]> {
  if (careerCache.has(playerId)) return careerCache.get(playerId)!;

  const seasons = await db.select({
    year: players.year,
    team: players.team,
    zScorePosition: players.zScorePosition,
    stats: players.stats,
  })
    .from(players)
    .where(eq(players.playerId, playerId))
    .orderBy(players.year);

  const career = seasons.map(s => ({
    year: s.year,
    team: s.team ?? 'unknown',
    legendScore: calculateSandlotScore(Number(s.zScorePosition)),
    stats: s.stats as Record<string, number>,
  }));

  careerCache.set(playerId, career);
  return career;
}

// Build structured career context text for the prompt
function buildCareerContext(targetYear: number, career: CareerSeason[]): string {
  if (career.length === 0) return 'No career data available.';

  const lines: string[] = [];
  const targetIdx = career.findIndex(s => s.year === targetYear);

  // Career span
  const firstYear = career[0].year;
  const lastYear = career[career.length - 1].year;
  lines.push(`Career span: ${firstYear}-${lastYear} (${career.length} seasons in our dataset)`);

  // Teams
  const teams = [...new Set(career.map(s => s.team))];
  if (teams.length > 1) {
    lines.push(`Teams: ${teams.join(', ')}`);
  }

  // Best and worst seasons
  const best = career.reduce((a, b) => a.legendScore > b.legendScore ? a : b);
  const worst = career.reduce((a, b) => a.legendScore < b.legendScore ? a : b);
  lines.push(`Best season: ${best.year} (${best.team}) — Sandlot Score ${best.legendScore.toFixed(1)} ${getSandlotLabel(best.legendScore)}`);
  if (worst.year !== best.year) {
    lines.push(`Worst season: ${worst.year} (${worst.team}) — Sandlot Score ${worst.legendScore.toFixed(1)} ${getSandlotLabel(worst.legendScore)}`);
  }

  // Is this their peak?
  const isPeak = targetIdx >= 0 && career[targetIdx].legendScore === best.legendScore;
  if (isPeak) {
    lines.push(`>>> This is their PEAK season in our dataset <<<`);
  }

  // Career position
  if (targetIdx >= 0) {
    const pct = targetIdx / (career.length - 1 || 1);
    const phase = pct <= 0.25 ? 'early career' : pct <= 0.6 ? 'mid-career' : 'late career';
    lines.push(`Season position: ${phase} (season ${targetIdx + 1} of ${career.length})`);
  }

  // Previous and next year context
  if (targetIdx > 0) {
    const prev = career[targetIdx - 1];
    lines.push(`Previous year: ${prev.year} (${prev.team}) — Sandlot Score ${prev.legendScore.toFixed(1)}`);
  }
  if (targetIdx >= 0 && targetIdx < career.length - 1) {
    const next = career[targetIdx + 1];
    lines.push(`Following year: ${next.year} (${next.team}) — Sandlot Score ${next.legendScore.toFixed(1)}`);
  }

  // Team change detection
  if (targetIdx > 0) {
    const prev = career[targetIdx - 1];
    const curr = career[targetIdx];
    if (prev.team !== curr.team) {
      lines.push(`>>> Changed teams from ${prev.team} to ${curr.team} before this season <<<`);
    }
  }

  // Streak of elite seasons
  if (targetIdx >= 0) {
    let streakStart = targetIdx;
    let streakEnd = targetIdx;
    while (streakStart > 0 && career[streakStart - 1].legendScore >= 7.0) streakStart--;
    while (streakEnd < career.length - 1 && career[streakEnd + 1].legendScore >= 7.0) streakEnd++;
    const streakLen = streakEnd - streakStart + 1;
    if (streakLen >= 3) {
      lines.push(`Elite streak: ${streakLen} consecutive seasons with Sandlot Score 7.0+ (${career[streakStart].year}-${career[streakEnd].year})`);
    }
  }

  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are a witty baseball writer texting a friend about a player-season. You have deep knowledge of baseball history — awards, MVP voting, All-Star selections, injuries, trades, team context, and memorable moments.

RULES:
- Write 4-5 sentences, 80-130 words
- Lead with the most interesting angle (context > raw stats)
- Include 2+ specific stats woven naturally into the narrative
- Put this season in career context — is this a peak, a down year, a bounce-back, a swan song?
- Draw on your knowledge of baseball history — awards, MVP races, injuries, trades, team storylines. Our stats tell the numbers; you bring the story.
- Match tone to tier: Sandlot Legend = awe, Elite = respect, Solid = appreciation, Average/Bench = honest but not cruel
- No hedging ("arguably", "perhaps"). Be definitive.
- Write ONLY the blurb text, no quotes or attribution.

FORMATTING:
- Use **bold** for key stats (e.g. **33 homers**, **.306 average**, **2.36 ERA**). Bold 2-4 stats per blurb.
- Use *italic* sparingly for emphasis on colorful phrases or narrative beats (e.g. *that* kind of season).
- Avoid em dashes (—). Use commas, periods, colons, or semicolons instead. Rewrite sentences rather than reaching for a dash.

EXAMPLES:

[SANDLOT LEGEND batter — Mike Trout, 2017 LAA, Sandlot Score 9.2]
Look, a "down year" for Trout still means **.306/.442/.629** with **33 homers** in just 114 games. A calf injury robbed us of what could have been another MVP campaign; he was on pace for 47 dingers. Even hobbled, he posted a **185 OPS+** that would be the best season of most careers. The man is simply unfair. You could argue this is the most impressive "disappointing" season in modern baseball history.

[SANDLOT LEGEND pitcher — Greg Maddux, 1993 ATL, Sandlot Score 9.5]
Maddux's first year in Atlanta after leaving the Cubs was an absolute masterclass: **20 wins**, a **2.36 ERA**, and just **52 walks** in 267 innings. This was the beginning of the most dominant four-year pitching stretch of the modern era, winning his second consecutive Cy Young. He painted corners like Rembrandt and made hitters look foolish doing it. The Braves got the best pitcher on the planet as a free agent, and he somehow exceeded expectations.

[AVERAGE batter — Derek Jeter, 2010 NYA, Sandlot Score 4.8]
Father Time started whispering to The Captain in 2010. A **.270 average** and **10 homers** from your 36-year-old shortstop isn't embarrassing, but this was a far cry from the Jeter who once hit .349. The Yankees still made the ALCS, but Jeter's declining range at short was becoming impossible to ignore. A quiet bridge year before his famous contract drama. The mystique was still there, but the bat speed *wasn't*.

[SOLID pitcher — Mark Buehrle, 2007 CHA, Sandlot Score 6.3]
Somehow Buehrle threw a no-hitter against the Rangers in April and still only managed a **3.63 ERA** for the year. That's the most Mark Buehrle stat line imaginable. He ate **201 innings** with his trademark pace, working so fast that fielders barely had time to spit between pitches. A reliable workhorse who happened to have one magic night tucked into an otherwise solid season. If every starter in your rotation pitched like Buehrle, you'd win 90 games and never stress about it.`;

// Post-process blurb text: ensure em-dashes have exactly one space on each side
function normalizeBlurb(text: string): string {
  // Normalize em-dashes: ensure exactly one space on each side
  return text.replace(/\s*—\s*/g, ' — ');
}

const MAX_RETRIES = 2;
const BACKOFF_MS = [1000, 3000]; // 1s, 3s

// Generate a blurb using GPT-5.2 with web search for real-time context.
// Retries up to MAX_RETRIES times with exponential backoff on failure.
async function generateBlurb(info: PlayerYearInfo): Promise<string> {
  const client = getOpenAIClient();
  if (!client) return getTemplateBlurb(info);

  const statsStr = Object.entries(info.stats)
    .map(([k, v]) => `${k}: ${typeof v === 'number' && v % 1 !== 0 ? v.toFixed(3) : v}`)
    .join(', ');

  const userPrompt = `Player: ${info.playerName}
Year: ${info.year}
Team: ${info.team}
Position: ${info.position}
Player type: ${info.playerType}
Sandlot Score: ${info.legendScore.toFixed(1)}/10.0 (${info.legendLabel})

Season stats: ${statsStr}

Career context:
${info.careerContext}

Write a 4-5 sentence blurb (80-130 words) about this player-season.`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = BACKOFF_MS[attempt - 1] ?? 3000;
        console.log(`  Retry ${attempt}/${MAX_RETRIES} for ${info.playerName} ${info.year} (waiting ${delay}ms)...`);
        await new Promise(r => setTimeout(r, delay));
      }

      const response = await client.responses.create({
        model: 'gpt-5.2',
        instructions: SYSTEM_PROMPT,
        input: userPrompt,
        tools: [{ type: 'web_search' as const }],
        temperature: 0.85,
        max_output_tokens: 350,
      });

      const text = response.output_text?.trim();
      return text ? normalizeBlurb(text) : getTemplateBlurb(info);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) continue;
    }
  }

  console.error('OpenAI blurb error (all retries exhausted):', lastError);
  return getTemplateBlurb(info);
}

// Template-based fallback blurbs (3-4 sentences, tier-aware)
function getTemplateBlurb(info: PlayerYearInfo): string {
  const { playerName, year, team, stats, legendScore, playerType } = info;
  const lastName = playerName.split(' ').pop();
  const shortYear = String(year).slice(2);

  if (playerType === 'batter') {
    const hr = stats.HR || stats.hr || 0;
    const avg = stats.AVG || stats.avg || 0;
    const rbi = stats.RBI || stats.rbi || 0;
    const sb = stats.SB || stats.sb || 0;
    const fmtAvg = typeof avg === 'number' ? avg.toFixed(3) : avg;

    if (legendScore >= 8) {
      return `${lastName} was an absolute force in '${shortYear}, hitting ${fmtAvg} with ${hr} homers and ${rbi} RBI for ${team}. This was the kind of season that makes you stop and stare at the stat line. ${sb > 15 ? `Adding ${sb} stolen bases to that power output is just showing off.` : `The kind of production that anchors a lineup and terrifies opposing pitchers.`} A truly elite campaign. Seasons like this are why you build a franchise around a player.`;
    } else if (legendScore >= 5) {
      return `A solid '${shortYear} for ${lastName} with ${team} — ${hr} HR, ${rbi} RBI, and a ${fmtAvg} average. Not the kind of season that makes highlight reels, but the kind contenders need from their everyday guys. ${sb > 10 ? `Chipped in ${sb} steals for good measure.` : `Steady and reliable across the full 162.`} Professional baseball at its finest. Every winning clubhouse needs a guy putting up numbers like these.`;
    } else {
      return `${lastName} had a forgettable ${year} with ${team}, hitting just ${fmtAvg} with ${hr} homers. The kind of season you hope is an outlier rather than a trend. ${rbi > 40 ? `Still managed to drive in ${rbi} runs through sheer persistence.` : `The RBI total of ${rbi} tells the story of a lineup spot that needed an upgrade.`} Sometimes baseball humbles even the best. You don't remember the bad years until someone pulls up the stats.`;
    }
  } else {
    const era = stats.ERA || stats.era || 0;
    const w = stats.W || stats.w || 0;
    const so = stats.SO || stats.so || stats.K || stats.k || 0;
    const whip = stats.WHIP || stats.whip || 0;
    const fmtEra = typeof era === 'number' ? era.toFixed(2) : era;
    const fmtWhip = typeof whip === 'number' ? whip.toFixed(2) : whip;

    if (legendScore >= 8) {
      return `${lastName} was electric in '${shortYear} — ${w} wins with a ${fmtEra} ERA and ${so} strikeouts for ${team}. A WHIP of ${fmtWhip} means baserunners were a rare sight when this arm was on the mound. ${so > 200 ? `Fanning ${so} batters is the kind of dominance that changes games.` : `Every start felt like an event.`} This was pitching at its absolute peak. The kind of arm that makes a rotation elite and a team dangerous in October.`;
    } else if (legendScore >= 5) {
      return `A workmanlike ${year} for ${lastName} with ${team}, posting a ${fmtEra} ERA across ${w} wins. The ${so} strikeouts and ${fmtWhip} WHIP paint the picture of a reliable arm you could count on every fifth day. Not flashy, but exactly the kind of starter contending teams covet. Ate innings and kept his team in ballgames. You don't win a pennant without a guy like this in your rotation.`;
    } else {
      return `${lastName} had a rough go of it in ${year} with ${team}, posting a ${fmtEra} ERA that had the coaching staff reaching for the bullpen phone. The ${so} strikeouts showed flashes, but a ${fmtWhip} WHIP means there were too many free passes. ${w > 8 ? `Still scraped together ${w} wins, mostly on run support.` : `Just ${w} wins in a season to forget.`} Every pitcher has years like this. The best ones use it as fuel and come back stronger.`;
    }
  }
}

// Run async tasks with bounded concurrency
async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function runNext(): Promise<void> {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => runNext()));
  return results;
}

// Generate (or regenerate) blurbs for a single round option (all year options)
export async function generateBlurbsForOption(optionId: number): Promise<{
  generated: number;
  failed: number;
  blurbs: Record<string, string>;
}> {
  careerCache.clear();

  const [option] = await db.select()
    .from(roundOptions)
    .where(eq(roundOptions.id, optionId))
    .limit(1);

  if (!option) throw new Error('Round option not found');

  // Get the round to find the position
  const [round] = await db.select()
    .from(challengeRounds)
    .where(eq(challengeRounds.id, option.roundId))
    .limit(1);

  if (!round) throw new Error('Round not found');

  const years = option.yearOptions as number[];
  const career = await getCareerContext(option.playerId);
  const newBlurbs: Record<string, string> = {};
  let generated = 0;
  let failed = 0;

  for (const year of years) {
    const [playerRecord] = await db.select()
      .from(players)
      .where(and(
        eq(players.playerId, option.playerId),
        eq(players.year, year)
      ))
      .limit(1);

    if (!playerRecord) {
      failed++;
      continue;
    }

    const legendScore = calculateSandlotScore(Number(playerRecord.zScorePosition));
    const careerContext = buildCareerContext(year, career);

    try {
      const blurb = await generateBlurb({
        playerName: option.playerName,
        year,
        team: playerRecord.team || 'unknown',
        position: round.position,
        playerType: playerRecord.playerType,
        stats: playerRecord.stats as Record<string, number>,
        legendScore,
        legendLabel: getSandlotLabel(legendScore),
        careerContext,
      });

      newBlurbs[String(year)] = blurb;
      generated++;
      console.log(`  ✓ ${option.playerName} ${year} (${legendScore.toFixed(1)} ${getSandlotLabel(legendScore)})`);
    } catch (err) {
      console.error(`  ✗ Failed: ${option.playerName} ${year}:`, err);
      failed++;
    }
  }

  // Update DB with new blurbs
  await db.update(roundOptions)
    .set({ blurbs: newBlurbs })
    .where(eq(roundOptions.id, optionId));

  careerCache.clear();

  return { generated, failed, blurbs: newBlurbs };
}

// Generate blurbs for all player-year options in a challenge
export async function generateBlurbsForChallenge(challengeId: number): Promise<{
  generated: number;
  failed: number;
  failedOptionIds: number[];
}> {
  // Clear career cache at start of each generation run
  careerCache.clear();

  const rounds = await db.select()
    .from(challengeRounds)
    .where(eq(challengeRounds.challengeId, challengeId));

  // Collect all blurb tasks upfront
  interface BlurbTask {
    option: any;
    round: typeof rounds[0];
    year: number;
    playerRecord: any;
    career: CareerSeason[];
  }
  const allTasks: BlurbTask[] = [];

  for (const round of rounds) {
    const options = await db.select()
      .from(roundOptions)
      .where(eq(roundOptions.roundId, round.id));

    for (const option of options) {
      const years = option.yearOptions as number[];
      const career = await getCareerContext(option.playerId);

      for (const year of years) {
        const [playerRecord] = await db.select()
          .from(players)
          .where(and(
            eq(players.playerId, option.playerId),
            eq(players.year, year)
          ))
          .limit(1);

        if (playerRecord) {
          allTasks.push({ option, round, year, playerRecord, career });
        }
      }
    }
  }

  console.log(`  Generating ${allTasks.length} blurbs (8 concurrent)...`);

  // Generate all blurbs in parallel (8 concurrent API calls)
  let generated = 0;
  let failed = 0;
  const failedOptionIds = new Set<number>();
  const blurbResults = new Map<number, Record<string, string>>(); // optionId -> { year: blurb }

  const tasks = allTasks.map((task) => async () => {
    const legendScore = calculateSandlotScore(Number(task.playerRecord.zScorePosition));
    const careerContext = buildCareerContext(task.year, task.career);

    try {
      const blurb = await generateBlurb({
        playerName: (task.option as any).playerName,
        year: task.year,
        team: task.playerRecord.team || 'unknown',
        position: task.round.position,
        playerType: task.playerRecord.playerType,
        stats: task.playerRecord.stats as Record<string, number>,
        legendScore,
        legendLabel: getSandlotLabel(legendScore),
        careerContext,
      });

      const optionId = (task.option as any).id;
      if (!blurbResults.has(optionId)) blurbResults.set(optionId, {});
      blurbResults.get(optionId)![String(task.year)] = blurb;
      generated++;
      console.log(`  ✓ ${(task.option as any).playerName} ${task.year} (${legendScore.toFixed(1)} ${getSandlotLabel(legendScore)})`);
    } catch (err) {
      console.error(`  ✗ Failed: ${(task.option as any).playerName} ${task.year}:`, err);
      failed++;
      failedOptionIds.add((task.option as any).id);
    }
  });

  await parallelLimit(tasks, 8);

  // Batch-update all round options with their blurbs
  for (const [optionId, blurbs] of blurbResults) {
    await db.update(roundOptions)
      .set({ blurbs })
      .where(eq(roundOptions.id, optionId));
  }

  // Clear cache after generation
  careerCache.clear();

  return { generated, failed, failedOptionIds: [...failedOptionIds] };
}
