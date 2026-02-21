import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db/index.js';
import { challengeRounds, roundOptions, players } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { getTeamName } from '../lib/teams.js';
import { asyncPool } from '../lib/asyncPool.js';

// Lazy-load OpenAI client
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// Resolve portrait directory:
//   Production: PORTRAIT_DIR env var (Railway Volume), or frontend/dist/portraits/
//   Development: frontend/public/portraits/ (Vite serves public/ directly)
// In production, Express serves frontend/dist/ as static, so generated portraits
// must go there (not public/, which doesn't survive the Vite build).
const PORTRAITS_DIR = process.env.PORTRAIT_DIR
  || (process.env.NODE_ENV === 'production'
    ? path.resolve(import.meta.dirname ?? process.cwd(), '../../../frontend/dist/portraits')
    : path.resolve(import.meta.dirname ?? process.cwd(), '../../../frontend/public/portraits'));

function getPortraitPath(playerId: string): string {
  return path.join(PORTRAITS_DIR, `${playerId}.png`);
}

function portraitExists(playerId: string): boolean {
  return fs.existsSync(getPortraitPath(playerId));
}

function buildPrompt(playerName: string, teamName: string, year: number): string {
  return `Generate a stylized head-and-shoulders portrait of Major League Baseball player ${playerName} playing for the ${teamName} in ${year}.
1. Art Style: Strictly a "hedcut" stipple portrait (like the Wall Street Journal). Use fine dots and pointillism for shading. Do NOT use heavy cross-hatching or thick black lines.
2. Composition: A clean head-and-shoulders silhouette against a plain, unadorned background. No background scenery, no stadium arches, no abstract lines. Just the player. Image dimensions: 480px wide by 640px tall (3:4 aspect ratio, portrait orientation).
3. Color: Deep Midnight Navy ink (#0A1E2F) on a flat Warm Cream (#F5F0E8) background. The background must be a uniform solid color with no gradients, textures, or paper grain. High contrast, but with plenty of negative space on the face to keep it legible.
4. Vibe: Stoic, legendary, and vintage. A collected artifact.`;
}

async function generatePortrait(
  playerName: string,
  teamName: string,
  year: number,
): Promise<Buffer> {
  const client = getOpenAIClient();
  if (!client) throw new Error('OpenAI API key not configured');

  const prompt = buildPrompt(playerName, teamName, year);

  const response = await client.responses.create({
    model: 'gpt-5.2',
    input: prompt,
    tools: [
      { type: 'web_search' as const },
      { type: 'image_generation' as const },
    ],
  });

  // Extract image from response output items
  for (const item of response.output) {
    if (item.type === 'image_generation_call' && (item as any).result) {
      const b64 = (item as any).result;
      return Buffer.from(b64, 'base64');
    }
  }

  throw new Error('No image generated in response');
}

interface PortraitTask {
  optionId: number;
  playerId: string;
  playerName: string;
  teamName: string;
  year: number;
}

// Generate (or regenerate) a portrait for a single round option
export async function generatePortraitForOption(optionId: number): Promise<{
  generated: boolean;
  portraitUrl: string;
}> {
  // Ensure portraits directory exists
  if (!fs.existsSync(PORTRAITS_DIR)) {
    fs.mkdirSync(PORTRAITS_DIR, { recursive: true });
  }

  const [option] = await db.select()
    .from(roundOptions)
    .where(eq(roundOptions.id, optionId))
    .limit(1);

  if (!option) throw new Error('Round option not found');

  // Delete existing portrait from disk to force regeneration
  const existingPath = getPortraitPath(option.playerId);
  if (fs.existsSync(existingPath)) {
    fs.unlinkSync(existingPath);
  }

  // Pick the best year's team for the portrait prompt
  const years = option.yearOptions as number[];
  let bestTeam = 'Unknown';
  let bestYear = years[0] ?? 2000;
  let bestZ = -Infinity;

  for (const year of years) {
    const [record] = await db.select({
      team: players.team,
      zScorePosition: players.zScorePosition,
    })
      .from(players)
      .where(and(
        eq(players.playerId, option.playerId),
        eq(players.year, year),
      ))
      .limit(1);

    if (record) {
      const z = Number(record.zScorePosition);
      if (z > bestZ) {
        bestZ = z;
        bestTeam = record.team ?? 'Unknown';
        bestYear = year;
      }
    }
  }

  const teamName = getTeamName(bestTeam);
  console.log(`  Generating portrait for ${option.playerName} (${bestYear} ${teamName})...`);

  const imageBuffer = await generatePortrait(option.playerName, teamName, bestYear);

  // Save to disk
  fs.writeFileSync(existingPath, imageBuffer);

  // Update DB — append cache-buster so browsers/CDNs fetch the new image
  const portraitUrl = `/portraits/${option.playerId}.png?v=${Date.now()}`;
  await db.update(roundOptions)
    .set({ portraitUrl })
    .where(eq(roundOptions.id, optionId));

  console.log(`  ✓ ${option.playerName} portrait regenerated`);

  return { generated: true, portraitUrl };
}

export async function generatePortraitsForChallenge(challengeId: number): Promise<{
  generated: number;
  skipped: number;
  failed: number;
}> {
  // Ensure portraits directory exists
  if (!fs.existsSync(PORTRAITS_DIR)) {
    fs.mkdirSync(PORTRAITS_DIR, { recursive: true });
  }

  const rounds = await db.select()
    .from(challengeRounds)
    .where(eq(challengeRounds.challengeId, challengeId));

  // Collect all portrait tasks
  const tasks: PortraitTask[] = [];
  let skipped = 0;

  for (const round of rounds) {
    const options = await db.select()
      .from(roundOptions)
      .where(eq(roundOptions.roundId, round.id));

    for (const option of options) {
      // Skip if portrait already exists on disk
      if (portraitExists(option.playerId)) {
        // Still update DB URL if missing
        if (!option.portraitUrl) {
          await db.update(roundOptions)
            .set({ portraitUrl: `/portraits/${option.playerId}.png` })
            .where(eq(roundOptions.id, option.id));
        }
        skipped++;
        continue;
      }

      // Pick the best year's team for the portrait prompt
      const years = option.yearOptions as number[];
      let bestTeam = 'Unknown';
      let bestYear = years[0] ?? 2000;
      let bestZ = -Infinity;

      for (const year of years) {
        const [record] = await db.select({
          team: players.team,
          zScorePosition: players.zScorePosition,
        })
          .from(players)
          .where(and(
            eq(players.playerId, option.playerId),
            eq(players.year, year),
          ))
          .limit(1);

        if (record) {
          const z = Number(record.zScorePosition);
          if (z > bestZ) {
            bestZ = z;
            bestTeam = record.team ?? 'Unknown';
            bestYear = year;
          }
        }
      }

      tasks.push({
        optionId: option.id,
        playerId: option.playerId,
        playerName: option.playerName,
        teamName: getTeamName(bestTeam),
        year: bestYear,
      });
    }
  }

  console.log(`  Generating ${tasks.length} portraits (${skipped} already exist)...`);

  const { failures } = await asyncPool(
    tasks,
    5, // 5 concurrent — image gen is heavier than text
    async (task) => {
      const imageBuffer = await generatePortrait(task.playerName, task.teamName, task.year);

      // Save to disk
      const filePath = getPortraitPath(task.playerId);
      fs.writeFileSync(filePath, imageBuffer);

      // Update DB
      await db.update(roundOptions)
        .set({ portraitUrl: `/portraits/${task.playerId}.png` })
        .where(eq(roundOptions.id, task.optionId));

      console.log(`  ✓ ${task.playerName} (${task.year} ${task.teamName})`);
      return task.playerId;
    },
    {
      retries: 2,
      backoffMs: 2000,
      onProgress: (done, total) => {
        if (done % 5 === 0 || done === total) {
          console.log(`  Progress: ${done}/${total} portraits`);
        }
      },
    },
  );

  for (const f of failures) {
    console.error(`  ✗ Failed: ${f.item.playerName}:`, f.error.message);
  }

  return {
    generated: tasks.length - failures.length,
    skipped,
    failed: failures.length,
  };
}
