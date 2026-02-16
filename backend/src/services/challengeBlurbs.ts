import OpenAI from 'openai';
import { db } from '../db/index.js';
import { players, challengeRounds, roundOptions } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { calculateLegendScore } from './legendScore.js';

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
}

// Generate a blurb for a single player-year
export async function generateBlurb(info: PlayerYearInfo): Promise<string> {
  const client = getOpenAIClient();
  if (!client) return getTemplateBlurb(info);

  const statsStr = Object.entries(info.stats)
    .map(([k, v]) => `${k}: ${typeof v === 'number' && v % 1 !== 0 ? v.toFixed(3) : v}`)
    .join(', ');

  const prompt = `Write a single punchy sentence (max 30 words) about ${info.playerName}'s ${info.year} season with the ${info.team}. Position: ${info.position}. Stats: ${statsStr}. Legend Score: ${info.legendScore}/10.

Be specific about what made this season notable (or unremarkable). Use vivid baseball language. Examples of tone:
- "Bonds was a one-man wrecking crew in '01 — 73 bombs and an OBP that made pitchers weep."
- "A forgettable year for Griffey as injuries limited him to just 70 games."
- "The Big Unit was absolutely dealing, fanning 329 batters en route to his 4th straight Cy Young."

Write ONLY the sentence, no quotes or attribution.`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 80,
      temperature: 0.9,
    });
    return response.choices[0]?.message?.content?.trim() || getTemplateBlurb(info);
  } catch (error) {
    console.error('OpenAI blurb error:', error);
    return getTemplateBlurb(info);
  }
}

// Template-based fallback blurb
function getTemplateBlurb(info: PlayerYearInfo): string {
  const { playerName, year, team, stats, legendScore, playerType } = info;
  const lastName = playerName.split(' ').pop();

  if (playerType === 'batter') {
    const hr = stats.HR || stats.hr || 0;
    const avg = stats.AVG || stats.avg || 0;
    const rbi = stats.RBI || stats.rbi || 0;

    if (legendScore >= 8) {
      return `${lastName} was dominant in '${String(year).slice(2)} for ${team}, hitting ${typeof avg === 'number' ? avg.toFixed(3) : avg} with ${hr} homers and ${rbi} RBI.`;
    } else if (legendScore >= 5) {
      return `A solid ${year} for ${lastName} with ${team} — ${hr} HR and ${rbi} RBI in a productive campaign.`;
    } else {
      return `${lastName} had a quiet ${year} season with ${team}, putting up modest numbers across the board.`;
    }
  } else {
    const era = stats.ERA || stats.era || 0;
    const w = stats.W || stats.w || 0;
    const so = stats.SO || stats.so || stats.K || stats.k || 0;

    if (legendScore >= 8) {
      return `${lastName} was electric in '${String(year).slice(2)} — ${w} wins with a ${typeof era === 'number' ? era.toFixed(2) : era} ERA and ${so} strikeouts for ${team}.`;
    } else if (legendScore >= 5) {
      return `A workmanlike ${year} for ${lastName} with ${team}, posting a ${typeof era === 'number' ? era.toFixed(2) : era} ERA with ${so} K's.`;
    } else {
      return `${lastName} struggled at times in ${year} with ${team}, posting an ERA north of ${typeof era === 'number' ? era.toFixed(2) : era}.`;
    }
  }
}

// Generate blurbs for all player-year options in a challenge
export async function generateBlurbsForChallenge(challengeId: number): Promise<{ generated: number; failed: number }> {
  const rounds = await db.select()
    .from(challengeRounds)
    .where(eq(challengeRounds.challengeId, challengeId));

  let generated = 0;
  let failed = 0;

  for (const round of rounds) {
    const options = await db.select()
      .from(roundOptions)
      .where(eq(roundOptions.roundId, round.id));

    for (const option of options) {
      const years = option.yearOptions as number[];
      const blurbs: Record<string, string> = {};

      for (const year of years) {
        const [playerRecord] = await db.select()
          .from(players)
          .where(and(
            eq(players.playerId, option.playerId),
            eq(players.year, year)
          ))
          .limit(1);

        if (playerRecord) {
          try {
            const blurb = await generateBlurb({
              playerName: option.playerName,
              year,
              team: playerRecord.team || 'unknown',
              position: round.position,
              playerType: playerRecord.playerType,
              stats: playerRecord.stats as Record<string, number>,
              legendScore: calculateLegendScore(Number(playerRecord.zScorePosition)),
            });
            blurbs[String(year)] = blurb;
            generated++;
          } catch (err) {
            console.error(`Failed to generate blurb for ${option.playerName} ${year}:`, err);
            failed++;
          }
        }
      }

      // Update the round option with blurbs
      await db.update(roundOptions)
        .set({ blurbs })
        .where(eq(roundOptions.id, option.id));
    }
  }

  return { generated, failed };
}
