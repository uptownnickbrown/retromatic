import OpenAI from 'openai';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db/index.js';
import { challengeRounds, roundOptions, players, portraits } from '../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
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

/** Batch-lookup cached portrait URLs from the portraits table. */
export async function lookupCachedPortraits(playerIds: string[]): Promise<Map<string, string>> {
  if (playerIds.length === 0) return new Map();
  const rows = await db.select({ playerId: portraits.playerId, portraitUrl: portraits.portraitUrl })
    .from(portraits)
    .where(inArray(portraits.playerId, playerIds));
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.portraitUrl) map.set(row.playerId, row.portraitUrl);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Reference image lookup (Wikipedia + MLB headshots)
// ---------------------------------------------------------------------------

interface ReferenceImages {
  images: Buffer[];
  sources: string[];
}

/** Find reference photos of the player from Wikipedia and MLB. Returns all found. */
async function findReferenceImages(playerName: string): Promise<ReferenceImages> {
  const images: Buffer[] = [];
  const sources: string[] = [];

  // Source 1: Wikipedia — free, good coverage of notable MLB players
  try {
    let found = false;
    const wikiTitle = playerName.replace(/ /g, '_');
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(wikiTitle)}&prop=pageimages&pithumbsize=500&redirects=1&format=json`;
    const wikiResp = await fetch(wikiUrl);
    if (wikiResp.ok) {
      const data = await wikiResp.json() as any;
      const pages = data?.query?.pages ?? {};
      const page = Object.values(pages)[0] as any;
      const thumbUrl = page?.thumbnail?.source;
      if (thumbUrl) {
        const imgResp = await fetch(thumbUrl);
        if (imgResp.ok) {
          const buf = Buffer.from(await imgResp.arrayBuffer());
          if (buf.length > 0) {
            images.push(buf);
            sources.push(`Wikipedia (${buf.length} bytes)`);
            found = true;
          }
        }
      }
    }

    // Wikipedia fallback: search with "baseball" to handle disambiguation
    if (!found) {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(playerName + ' baseball')}&srlimit=3&format=json`;
      const searchResp = await fetch(searchUrl);
      if (searchResp.ok) {
        const searchData = await searchResp.json() as any;
        const results = searchData?.query?.search ?? [];
        for (const result of results) {
          const pageUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(result.title)}&prop=pageimages&pithumbsize=500&redirects=1&format=json`;
          const pageResp = await fetch(pageUrl);
          if (!pageResp.ok) continue;
          const pageData = await pageResp.json() as any;
          const pages2 = pageData?.query?.pages ?? {};
          const page2 = Object.values(pages2)[0] as any;
          const thumbUrl2 = page2?.thumbnail?.source;
          if (thumbUrl2) {
            const imgResp2 = await fetch(thumbUrl2);
            if (imgResp2.ok) {
              const buf = Buffer.from(await imgResp2.arrayBuffer());
              if (buf.length > 0) {
                images.push(buf);
                sources.push(`Wikipedia search (${buf.length} bytes)`);
                break; // only need one from search
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.log(`    Wikipedia lookup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Source 2: MLB headshots — always try, even if Wikipedia found one
  try {
    const mlbSearchUrl = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(playerName)}`;
    const mlbResp = await fetch(mlbSearchUrl);
    if (mlbResp.ok) {
      const mlbData = await mlbResp.json() as any;
      const mlbId = mlbData?.people?.[0]?.id;
      if (mlbId) {
        const headshotUrl = `https://img.mlbstatic.com/mlb-photos/image/upload/w_500,q_auto:best,f_auto/v1/people/${mlbId}/headshot/silo/current`;
        const imgResp = await fetch(headshotUrl);
        if (imgResp.ok) {
          const buf = Buffer.from(await imgResp.arrayBuffer());
          if (buf.length > 5000) {
            images.push(buf);
            sources.push(`MLB headshot (${buf.length} bytes)`);
          }
        }
      }
    }
  } catch (err) {
    console.log(`    MLB headshot lookup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const src of sources) console.log(`    Reference image: ${src}`);
  if (images.length === 0) console.log(`    No reference images found for ${playerName}`);
  return { images, sources };
}

// ---------------------------------------------------------------------------
// Generation prompt
// ---------------------------------------------------------------------------

const STYLE_INSTRUCTIONS = `Art Style: A "hedcut" stipple portrait exactly like the Wall Street Journal illustrations. Shading is created through varying density of small ink dots. Do NOT use halftone circles, pop-art dots, cross-hatching, or thick outlines. IMPORTANT: This image will be generated at 1024px but displayed at only 200px tall — make sure all detail (dots, facial features, uniform text) remains clearly legible when shrunk to 1/5th the size.
Composition: A clean head-and-shoulders silhouette against a plain, unadorned background. No background scenery, no stadium arches, no abstract lines. Just the player, in a standard front-facing or slight 3/4 view, centered in the frame. Image dimensions: 480px wide by 640px tall (3:4 aspect ratio, portrait orientation).
Color: Deep Midnight Navy ink (#0A1E2F) on a flat Warm Cream (#FCEDCD) background. The background must be a uniform solid color with no gradients, textures, or paper grain. High contrast, with generous negative space and light areas to keep the face legible at small sizes.
Vibe: Stoic, legendary, and vintage. A collected artifact.`;

function buildGenerationPrompt(
  playerName: string, teamName: string, year: number, position: string,
  description: string, refImageCount: number,
): string {
  const refImageNote = refImageCount > 0
    ? `Use the reference photo${refImageCount > 1 ? 's' : ''} provided as visual guidance for facial features, skin tone, build, and distinctive characteristics ONLY. Ignore the uniform, team logo, and hat in the reference photo${refImageCount > 1 ? 's' : ''} — instead depict the player wearing the ${teamName} uniform and cap. Regardless of the pose in the reference photo${refImageCount > 1 ? 's' : ''}, render the portrait in a standard front-facing or slight 3/4 view, centered in the frame.`
    : `Known appearance: ${description}`;

  return `Generate a stylized head-and-shoulders portrait of MLB ${position} ${playerName} (${teamName}, ${year}).
${playerName} is a public figure — a professional Major League Baseball player.

${refImageNote}

${STYLE_INSTRUCTIONS}`;
}

async function generatePortrait(
  playerName: string,
  teamName: string,
  year: number,
  position: string,
  description: string,
  referenceImages: Buffer[],
): Promise<Buffer> {
  const client = getOpenAIClient();
  if (!client) throw new Error('OpenAI API key not configured');

  const prompt = buildGenerationPrompt(playerName, teamName, year, position, description, referenceImages.length);

  // Build multimodal input: reference images (if any) + text prompt
  const content: Array<{ type: string; [key: string]: any }> = [];
  for (const img of referenceImages) {
    const b64Ref = img.toString('base64');
    content.push({
      type: 'input_image',
      image_url: `data:image/jpeg;base64,${b64Ref}`,
      detail: 'auto',
    });
  }
  content.push({ type: 'input_text', text: prompt });

  const response = await client.responses.create({
    model: 'gpt-5.2',
    input: [{ role: 'user' as const, content }] as any,
    tools: [
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

/**
 * Fallback: generate a portrait using DALL-E directly when gpt-5.2 won't
 * trigger its image_generation tool for a specific player.
 */
async function generatePortraitDallE(
  playerName: string,
  teamName: string,
  year: number,
  position: string,
  description: string,
): Promise<Buffer> {
  const client = getOpenAIClient();
  if (!client) throw new Error('OpenAI API key not configured');

  const prompt = `A "hedcut" stipple portrait of MLB ${position} ${playerName} (${teamName}, ${year}).
Known appearance: ${description}
Style: Wall Street Journal stipple illustration with shading from varying density of small ink dots. NO halftone circles, pop-art dots, cross-hatching, or thick outlines.
Composition: Clean head-and-shoulders silhouette, plain background, 480×640px (3:4 portrait).
Color: Deep Midnight Navy ink (#0A1E2F) on flat Warm Cream (#FCEDCD). Generous negative space.
Vibe: Stoic, legendary, vintage baseball card.`;

  console.log(`    DALL-E fallback for ${playerName}...`);

  const response = await client.images.generate({
    model: 'dall-e-3',
    prompt,
    size: '1024x1024',
    quality: 'hd',
    response_format: 'b64_json',
    n: 1,
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('DALL-E returned no image');
  return Buffer.from(b64, 'base64');
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

/** Describe player appearance from a reference photo (no web search needed). */
async function describeFromImage(
  imageBuffer: Buffer,
  playerName: string,
  teamName: string,
  year: number,
  position: string,
): Promise<string> {
  const client = getOpenAIClient();
  if (!client) return 'unknown appearance';

  const b64 = imageBuffer.toString('base64');

  const response = await client.responses.create({
    model: 'gpt-4.1',
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_image' as const,
            image_url: `data:image/jpeg;base64,${b64}`,
            detail: 'auto' as const,
          },
          {
            type: 'input_text',
            text: `I am an illustrator creating a stipple-art portrait (Wall Street Journal hedcut style) of MLB ${position} ${playerName} (${teamName}, ${year}) for a baseball history app. This is my reference photo. To guide my ink dot density and shading, describe what I see: complexion shade (light/medium/dark), face shape, build, facial hair, hair style and texture, and any distinguishing features. Brief comma-separated list only.`,
          },
        ],
      },
    ],
  });

  const text = response.output_text?.trim() ?? '';
  // If model refuses (common with real-person photos), fall back to web search
  if (!text || text.length < 20 || text.toLowerCase().includes("can't") || text.toLowerCase().includes('sorry')) {
    console.log(`    describeFromImage refused ("${text.slice(0, 50)}"), falling back to web search`);
    return describePlayer(playerName, teamName, year, position);
  }
  return text;
}

/** Validate a portrait against known player appearance. Binary pass/fail. */
export async function validatePortrait(
  imageBuffer: Buffer,
  playerName: string,
  teamName: string,
  year: number,
  position: string,
  description: string,
  referenceImages?: Buffer[],
): Promise<ValidationResult> {
  const client = getOpenAIClient();
  if (!client) return { pass: true, reason: 'No API key — skipping validation' };

  const b64 = imageBuffer.toString('base64');
  const refs = referenceImages?.filter(b => b.length > 0) ?? [];

  // Build content array: reference image(s) + generated portrait + text prompt
  const content: Array<{ type: string; [key: string]: any }> = [];

  // Include up to 2 reference images for comparison
  for (const ref of refs.slice(0, 2)) {
    const refB64 = ref.toString('base64');
    content.push({
      type: 'input_image',
      image_url: `data:image/jpeg;base64,${refB64}`,
      detail: 'auto',
    });
  }

  content.push({
    type: 'input_image',
    image_url: `data:image/webp;base64,${b64}`,
    detail: 'auto',
  });

  const refImageNote = refs.length > 0
    ? `The first ${refs.length > 1 ? `${Math.min(refs.length, 2)} images are reference photos` : 'image is a reference photo'} of the real player. The ${refs.length > 1 ? 'last' : 'second'} image is the AI-generated stipple portrait to validate. Compare the portrait to the reference photo${refs.length > 1 ? 's' : ''}.`
    : '';

  content.push({
    type: 'input_text',
    text: `You are validating an AI-generated stipple portrait (ink dots on cream paper).

${refImageNote}

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
  });

  const response = await client.responses.create({
    model: 'gpt-4.1',
    input: [
      {
        role: 'user',
        content,
      },
    ] as any,
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
  // Step 1: Find reference images (Wikipedia + MLB headshots)
  const { images: referenceImages, sources: refSources } = await findReferenceImages(playerName);

  // Step 2: Get player description (used for validation + no-image fallback generation)
  // With reference images: derive from the first photo (no web search, cheaper)
  // Without: fall back to web search describe
  let description: string;
  if (referenceImages.length > 0) {
    description = await describeFromImage(referenceImages[0], playerName, teamName, year, position);
  } else {
    description = await describePlayer(playerName, teamName, year, position);
  }
  console.log(`    Ref images: ${refSources.length > 0 ? refSources.join(' + ') : 'none'}`);
  console.log(`    Player description: ${description.slice(0, 120)}...`);

  // Step 3: Generate + validate loop
  let lastResult: { imageBuffer: Buffer; reason: string } | null = null;
  let generationFailures = 0;

  for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
    let rawBuffer: Buffer;
    try {
      rawBuffer = await generatePortrait(playerName, teamName, year, position, description, referenceImages);
    } catch (genErr) {
      const msg = genErr instanceof Error ? genErr.message : String(genErr);
      console.log(`    Attempt ${attempt}: GENERATION FAILED — ${msg}`);
      lastResult = { imageBuffer: Buffer.alloc(0), reason: msg };
      generationFailures++;
      continue;
    }

    const imageBuffer = await processImage(rawBuffer);
    const validation = await validatePortrait(imageBuffer, playerName, teamName, year, position, description, referenceImages);

    console.log(`    Attempt ${attempt}: ${validation.pass ? 'PASS' : 'FAIL'} — ${validation.reason}`);

    lastResult = { imageBuffer, reason: validation.reason };

    if (validation.pass) {
      return { imageBuffer, pass: true, reason: validation.reason, attempts: attempt };
    }
  }

  // If generation itself kept failing (model refused to generate), try DALL-E fallback
  if (generationFailures >= 2) {
    console.log(`    Primary generation failed ${generationFailures}/${MAX_VALIDATION_ATTEMPTS} times — trying DALL-E fallback...`);
    for (let fallback = 1; fallback <= 2; fallback++) {
      try {
        const rawBuffer = await generatePortraitDallE(playerName, teamName, year, position, description);
        const imageBuffer = await processImage(rawBuffer);
        const validation = await validatePortrait(imageBuffer, playerName, teamName, year, position, description, referenceImages);
        console.log(`    DALL-E fallback ${fallback}: ${validation.pass ? 'PASS' : 'FAIL'} — ${validation.reason}`);

        if (validation.pass) {
          return { imageBuffer, pass: true, reason: validation.reason, attempts: MAX_VALIDATION_ATTEMPTS + fallback };
        }
        lastResult = { imageBuffer, reason: validation.reason };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`    DALL-E fallback ${fallback}: ERROR — ${msg}`);
        lastResult = { imageBuffer: Buffer.alloc(0), reason: msg };
      }
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
// Standalone player generation (no optionId needed — for pre-generation)
// ---------------------------------------------------------------------------

export async function generatePortraitForPlayer(
  playerId: string,
  playerName: string,
  teamName: string,
  year: number,
  position: string,
): Promise<{ generated: boolean; portraitUrl: string; attempts: number }> {
  // Ensure portraits directory exists
  if (!fs.existsSync(PORTRAITS_DIR)) {
    fs.mkdirSync(PORTRAITS_DIR, { recursive: true });
  }

  const posLabel = POSITION_LABELS[position] ?? position;

  const { imageBuffer, attempts } = await generateValidatedPortrait(
    playerName, teamName, year, posLabel,
  );

  // Save to disk
  const filePath = getPortraitPath(playerId);
  fs.writeFileSync(filePath, imageBuffer);
  const legacyPng = path.join(PORTRAITS_DIR, `${playerId}.png`);
  if (fs.existsSync(legacyPng)) fs.unlinkSync(legacyPng);

  // Update DB
  const portraitUrl = `/portraits/${playerId}.webp`;
  await markValidated(playerId, portraitUrl);

  // Update any round_options rows that reference this player
  await db.update(roundOptions)
    .set({ portraitUrl })
    .where(eq(roundOptions.playerId, playerId));

  return { generated: true, portraitUrl, attempts };
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
        const portraitUrl = `/portraits/${option.playerId}.webp`;
        // Still update DB URL if missing
        if (!option.portraitUrl) {
          await db.update(roundOptions)
            .set({ portraitUrl })
            .where(eq(roundOptions.id, option.id));
        }
        // Ensure portraits table has an entry (don't overwrite validated status)
        await db.insert(portraits)
          .values({ playerId: option.playerId, validated: false, portraitUrl })
          .onConflictDoNothing();
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
