import OpenAI from 'openai';
import type { Player } from '../db/schema.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface TeamScoreResult {
  totalScore: number;
  percentile: number;
  categoryTotals: Record<string, number>;
  categoryPercentiles: Record<string, number>;
}

interface RotoResult {
  placement: number;
  scoreboard: Array<{
    rank: number;
    teamName: string;
    points: number;
    isUser: boolean;
  }>;
}

export async function generateCommentary(
  players: Player[],
  teamScore: TeamScoreResult,
  rotoResult: RotoResult
): Promise<string> {
  // Build context about the team
  const batters = players.filter(p => p.playerType === 'batter');
  const pitchers = players.filter(p => p.playerType === 'pitcher');

  const batterNames = batters.map(p => `${p.nameFirst} ${p.nameLast} (${p.year})`).join(', ');
  const pitcherNames = pitchers.map(p => `${p.nameFirst} ${p.nameLast} (${p.year})`).join(', ');

  const prompt = `You are a fun, enthusiastic baseball analyst. Generate a 2-3 sentence commentary about this fantasy baseball team that a user just drafted. Be specific about the players and their strengths. Keep it fun and engaging!

Team:
Batters: ${batterNames}
Pitchers: ${pitcherNames}

Results:
- Overall percentile: ${teamScore.percentile}th percentile
- Finished ${rotoResult.placement}${getOrdinalSuffix(rotoResult.placement)} in a 12-team roto league
- Best category: ${getBestCategory(teamScore.categoryPercentiles)}
- Weakest category: ${getWorstCategory(teamScore.categoryPercentiles)}

Write a short, punchy commentary that:
1. Mentions at least 2 specific players by name
2. Comments on a strength or weakness of the team
3. Uses baseball terminology
4. Is encouraging even if the team didn't score well

Keep it under 100 words.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
      temperature: 0.8,
    });

    return response.choices[0]?.message?.content || getDefaultCommentary(teamScore.percentile);
  } catch (error) {
    console.error('OpenAI API error:', error);
    return getDefaultCommentary(teamScore.percentile);
  }
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function getBestCategory(percentiles: Record<string, number>): string {
  let best = '';
  let bestVal = 0;
  for (const [cat, val] of Object.entries(percentiles)) {
    if (val > bestVal) {
      bestVal = val;
      best = cat;
    }
  }
  return `${best} (${bestVal}th percentile)`;
}

function getWorstCategory(percentiles: Record<string, number>): string {
  let worst = '';
  let worstVal = 100;
  for (const [cat, val] of Object.entries(percentiles)) {
    if (val < worstVal) {
      worstVal = val;
      worst = cat;
    }
  }
  return `${worst} (${worstVal}th percentile)`;
}

function getDefaultCommentary(percentile: number): string {
  if (percentile >= 90) {
    return "Outstanding draft! You've assembled an elite roster that would compete with the best teams ever assembled. Your baseball knowledge is impressive!";
  } else if (percentile >= 75) {
    return "Great draft! You've put together a very competitive team with solid contributors at every position. This squad would be a playoff contender in any league.";
  } else if (percentile >= 50) {
    return "Solid draft! You've built a respectable roster with some nice pieces. A few more standout picks and you'd be challenging for the top spots.";
  } else if (percentile >= 25) {
    return "A work in progress! Your team has some interesting picks, but there's room for improvement. Keep drafting and your baseball memory will sharpen!";
  } else {
    return "An adventurous draft! You swung for the fences with some unconventional picks. Every championship team started somewhere - try again and climb those rankings!";
  }
}
