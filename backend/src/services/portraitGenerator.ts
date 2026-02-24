import OpenAI from 'openai';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db/index.js';
import { challengeRounds, roundOptions, players, portraits } from '../db/schema.js';
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
//   Production: PORTRAIT_DIR env var (Railway Volume at /data/portraits)
//   Development: frontend/public/portraits/ (Vite serves public/ directly)
const PORTRAITS_DIR = process.env.PORTRAIT_DIR
  || path.resolve(
    import.meta.dirname ?? process.cwd(),
    '../../../frontend/public/portraits',
  );

export function getPortraitPath(playerId: string): string {
  return path.join(PORTRAITS_DIR, `${playerId}.webp`);
}

export { PORTRAITS_DIR };

function portraitExists(playerId: string): boolean {
  return fs.existsSync(getPortraitPath(playerId));
}

// ---------------------------------------------------------------------------
// Generation prompt
// ---------------------------------------------------------------------------

function buildPrompt(playerName: string, teamName: string, year: number, position: string): string {
  return `First, search baseball-reference.com and gettyimages.com for photos of MLB ${position} ${playerName} who played for the ${teamName} in ${year}. Study the reference photos carefully.

Before drawing, describe ${playerName}'s appearance based on what you found: ethnicity/skin tone, face shape, build, facial hair, hair style, and any distinctive features.

Then generate a stylized head-and-shoulders portrait that accurately depicts ${playerName} with those characteristics.
1. Art Style: A "hedcut" stipple portrait exactly like the Wall Street Journal illustrations. Shading is created through varying density of small ink dots. Do NOT use halftone circles, pop-art dots, cross-hatching, or thick outlines. IMPORTANT: This image will be generated at 1024px but displayed at only 200px tall — make sure all detail (dots, facial features, uniform text) remains clearly legible when shrunk to 1/5th the size.
2. Composition: A clean head-and-shoulders silhouette against a plain, unadorned background. No background scenery, no stadium arches, no abstract lines. Just the player. Image dimensions: 480px wide by 640px tall (3:4 aspect ratio, portrait orientation).
3. Color: Deep Midnight Navy ink (#0A1E2F) on a flat Warm Cream (#FCEDCD) background. The background must be a uniform solid color with no gradients, textures, or paper grain. High contrast, with generous negative space and light areas to keep the face legible at small sizes.
4. Vibe: Stoic, legendary, and vintage. A collected artifact.`;
}

async function generatePortrait(
  playerName: string,
  teamName: string,
  year: number,
  position: string,
): Promise<Buffer> {
  const client = getOpenAIClient();
  if (!client) throw new Error('OpenAI API key not configured');

  const prompt = buildPrompt(playerName, teamName, year, position);

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

// ---------------------------------------------------------------------------
// Image post-processing
// ---------------------------------------------------------------------------

// Target background color — warm parchment
const CREAM_R = 0xFC, CREAM_G = 0xED, CREAM_B = 0xCD; // #FCEDCD
// Max Euclidean distance in RGB space for a pixel to count as "background"
const BG_THRESHOLD = 40;

/** Resize to 200px height, normalize background to exact cream, convert to WebP */
export async function processImage(rawBuffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(rawBuffer)
    .resize({ height: 200 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // Replace near-cream pixels with exact cream, leave everything else untouched
  for (let i = 0; i < data.length; i += 3) {
    const dr = data[i] - CREAM_R;
    const dg = data[i + 1] - CREAM_G;
    const db = data[i + 2] - CREAM_B;
    if (Math.sqrt(dr * dr + dg * dg + db * db) < BG_THRESHOLD) {
      data[i]     = CREAM_R;
      data[i + 1] = CREAM_G;
      data[i + 2] = CREAM_B;
    }
  }

  return sharp(data, { raw: { width, height, channels: 3 } })
    .webp({ quality: 90 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Validation: describe player → binary pass/fail
// ---------------------------------------------------------------------------

const MAX_VALIDATION_ATTEMPTS = 3;

export interface ValidationResult {
  pass: boolean;
  reason: string;
}

interface ValidatedPortrait {
  imageBuffer: Buffer;
  pass: boolean;
  reason: string;
  attempts: number;
}

/** Look up a player's visual appearance via web search (cheap text call). */
export async function describePlayer(
  playerName: string,
  teamName: string,
  year: number,
  position: string,
): Promise<string> {
  const client = getOpenAIClient();
  if (!client) return 'unknown appearance';

  const response = await client.responses.create({
    model: 'gpt-4.1',
    tools: [{ type: 'web_search' as const }],
    input: `Search for photos of MLB ${position} ${playerName} who played for the ${teamName} around ${year}. Based on photos from that era, describe their appearance in a brief comma-separated list: race/ethnicity, skin tone (be specific — light, medium, dark), face shape, build, facial hair, hair style, and any distinctive features that would help identify them in a portrait. Keep it factual and concise. ONLY the list.`,
  });

  return response.output_text?.trim() ?? 'unknown appearance';
}

/** Validate a portrait against known player appearance. Binary pass/fail. */
export async function validatePortrait(
  imageBuffer: Buffer,
  playerName: string,
  teamName: string,
  year: number,
  position: string,
  description: string,
): Promise<ValidationResult> {
  const client = getOpenAIClient();
  if (!client) return { pass: true, reason: 'No API key — skipping validation' };

  const b64 = imageBuffer.toString('base64');

  const response = await client.responses.create({
    model: 'gpt-4.1',
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_image' as const,
            image_url: `data:image/webp;base64,${b64}`,
            detail: 'auto' as const,
          },
          {
            type: 'input_text',
            text: `You are validating an AI-generated stipple portrait (ink dots on cream paper).

This portrait is supposed to depict: MLB ${position} ${playerName}, ${teamName}, ${year}.
Known appearance: ${description}

This is stipple art, so skin tone is conveyed through dot density rather than actual color. Focus your evaluation on:
- Face shape and structure
- Ethnicity (facial features, not just skin shade in the art)
- Hair style
- Facial hair or lack thereof
- Build and proportions
- Any distinctive features

A portrait should be rejected if it clearly depicts the wrong person — wrong ethnicity, wrong face shape, or looks completely generic. A portrait should pass if the face is a reasonable artistic rendering of this specific player.

Respond with ONLY JSON: {"pass": true/false, "reason": "<brief explanation>"}`,
          },
        ],
      },
    ],
  });

  try {
    const text = response.output_text?.trim() ?? '';
    const jsonStr = text.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = JSON.parse(jsonStr);
    return {
      pass: Boolean(parsed.pass),
      reason: String(parsed.reason ?? ''),
    };
  } catch {
    console.warn('  Portrait validation parse error, assuming fail');
    return { pass: false, reason: 'Could not parse validation response' };
  }
}

/** Generate a portrait with quality validation and auto-retry. Throws if all attempts fail. */
async function generateValidatedPortrait(
  playerName: string,
  teamName: string,
  year: number,
  position: string,
): Promise<ValidatedPortrait> {
  // Describe the player once — used for all validation attempts
  const description = await describePlayer(playerName, teamName, year, position);
  console.log(`    Player description: ${description.slice(0, 120)}...`);

  let lastResult: { imageBuffer: Buffer; reason: string } | null = null;

  for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
    const rawBuffer = await generatePortrait(playerName, teamName, year, position);
    const imageBuffer = await processImage(rawBuffer);
    const validation = await validatePortrait(imageBuffer, playerName, teamName, year, position, description);

    console.log(`    Attempt ${attempt}: ${validation.pass ? 'PASS' : 'FAIL'} — ${validation.reason}`);

    lastResult = { imageBuffer, reason: validation.reason };

    if (validation.pass) {
      return { imageBuffer, pass: true, reason: validation.reason, attempts: attempt };
    }
  }

  // All attempts failed — throw so caller knows not to save
  throw new Error(`Portrait validation failed after ${MAX_VALIDATION_ATTEMPTS} attempts for ${playerName}: ${lastResult?.reason ?? 'unknown'}`);
}

// ---------------------------------------------------------------------------
// Audit: validate an existing portrait on disk
// ---------------------------------------------------------------------------

/** Validate an existing portrait file. Returns pass/fail with reason. */
export async function auditPortrait(
  playerId: string,
  playerName: string,
  teamName: string,
  year: number,
  position: string,
): Promise<ValidationResult> {
  const filePath = getPortraitPath(playerId);
  if (!fs.existsSync(filePath)) {
    return { pass: false, reason: 'Portrait file not found' };
  }

  const imageBuffer = fs.readFileSync(filePath);
  const description = await describePlayer(playerName, teamName, year, position);
  return validatePortrait(imageBuffer, playerName, teamName, year, position, description);
}

// ---------------------------------------------------------------------------
// Position labels + DB helpers
// ---------------------------------------------------------------------------

export const POSITION_LABELS: Record<string, string> = {
  SP: 'starting pitcher', RP: 'relief pitcher', P: 'pitcher',
  C: 'catcher', '1B': 'first baseman', '2B': 'second baseman',
  SS: 'shortstop', '3B': 'third baseman', OF: 'outfielder',
  UTIL: 'designated hitter',
};

interface PortraitTask {
  optionId: number;
  playerId: string;
  playerName: string;
  teamName: string;
  year: number;
  position: string;
}

/** Upsert the portraits table to mark a portrait as validated. */
async function markValidated(playerId: string, portraitUrl: string): Promise<void> {
  await db.insert(portraits)
    .values({ playerId, validated: true, validatedAt: new Date(), portraitUrl })
    .onConflictDoUpdate({
      target: portraits.playerId,
      set: { validated: true, validatedAt: new Date(), portraitUrl },
    });
}

// ---------------------------------------------------------------------------
// Single-option generation (admin regen button)
// ---------------------------------------------------------------------------

// Generate (or regenerate) a portrait for a single round option
export async function generatePortraitForOption(optionId: number): Promise<{
  generated: boolean;
  portraitUrl: string;
  pass: boolean;
  attempts: number;
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

  // Look up the round's position for prompt context
  const [round] = await db.select({ position: challengeRounds.position })
    .from(challengeRounds)
    .where(eq(challengeRounds.id, option.roundId))
    .limit(1);

  // Pick the best year's team for the portrait prompt
  const years = option.yearOptions as number[];
  let bestTeam = 'Unknown';
  let bestYear = years[0] ?? 2000;
  let bestZ = -Infinity;
  let bestPosition = round?.position ?? 'player';

  for (const year of years) {
    const [record] = await db.select({
      team: players.team,
      zScorePosition: players.zScorePosition,
      primaryPosition: players.primaryPosition,
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
        bestPosition = record.primaryPosition;
      }
    }
  }

  const teamName = getTeamName(bestTeam);
  const posLabel = POSITION_LABELS[bestPosition] ?? bestPosition;
  console.log(`  Generating portrait for ${option.playerName} (${posLabel}, ${bestYear} ${teamName})...`);

  // Generate with quality validation and auto-retry (throws on all-fail)
  const { imageBuffer, pass, attempts } = await generateValidatedPortrait(
    option.playerName, teamName, bestYear, posLabel,
  );

  // Save to disk (only reached if validation passed)
  const existingPath = getPortraitPath(option.playerId);
  fs.writeFileSync(existingPath, imageBuffer);
  const legacyPng = path.join(PORTRAITS_DIR, `${option.playerId}.png`);
  if (fs.existsSync(legacyPng)) fs.unlinkSync(legacyPng);

  // Update DB — append cache-buster so browsers/CDNs fetch the new image
  const portraitUrl = `/portraits/${option.playerId}.webp?v=${Date.now()}`;
  await db.update(roundOptions)
    .set({ portraitUrl })
    .where(eq(roundOptions.id, optionId));

  // Mark validated in portraits table
  await markValidated(option.playerId, portraitUrl);

  console.log(`  ✓ ${option.playerName} portrait regenerated (${attempts} attempt${attempts > 1 ? 's' : ''})`);

  return { generated: true, portraitUrl, pass, attempts };
}

// ---------------------------------------------------------------------------
// Bulk challenge generation
// ---------------------------------------------------------------------------

export async function generatePortraitsForChallenge(challengeId: number): Promise<{
  generated: number;
  skipped: number;
  failed: number;
  retried: number;
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
            .set({ portraitUrl: `/portraits/${option.playerId}.webp` })
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
      let bestPosition = round.position;

      for (const year of years) {
        const [record] = await db.select({
          team: players.team,
          zScorePosition: players.zScorePosition,
          primaryPosition: players.primaryPosition,
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
            bestPosition = record.primaryPosition;
          }
        }
      }

      tasks.push({
        optionId: option.id,
        playerId: option.playerId,
        playerName: option.playerName,
        teamName: getTeamName(bestTeam),
        year: bestYear,
        position: POSITION_LABELS[bestPosition] ?? bestPosition,
      });
    }
  }

  console.log(`  Generating ${tasks.length} portraits (${skipped} already exist)...`);

  let retried = 0;
  const { failures } = await asyncPool(
    tasks,
    5, // 5 concurrent — image gen is heavier than text
    async (task) => {
      const { imageBuffer, attempts } = await generateValidatedPortrait(
        task.playerName, task.teamName, task.year, task.position,
      );
      if (attempts > 1) retried++;

      // Save to disk
      const filePath = getPortraitPath(task.playerId);
      fs.writeFileSync(filePath, imageBuffer);

      // Update round_options DB
      const portraitUrl = `/portraits/${task.playerId}.webp`;
      await db.update(roundOptions)
        .set({ portraitUrl })
        .where(eq(roundOptions.id, task.optionId));

      // Mark validated in portraits table
      await markValidated(task.playerId, portraitUrl);

      console.log(`  ✓ ${task.playerName} (${task.year} ${task.teamName}) — ${attempts} attempt${attempts > 1 ? 's' : ''}`);
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
    retried,
  };
}
