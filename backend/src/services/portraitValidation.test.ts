/**
 * Portrait validation integration test.
 *
 * Runs real API calls against OpenAI to validate the describe → validate pipeline.
 * Skipped automatically when OPENAI_API_KEY is not set (CI).
 *
 * Run manually: npm run test:portraits
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// Load .env for API key
dotenv.config({ path: path.resolve(import.meta.dirname ?? process.cwd(), '../../.env') });

const FIXTURES_DIR = path.resolve(import.meta.dirname ?? process.cwd(), '__fixtures__/portraits');
const HAS_API_KEY = Boolean(process.env.OPENAI_API_KEY);

// Inline describe + validate to avoid importing DB-dependent portraitGenerator
async function describePlayerTest(
  client: OpenAI,
  playerName: string,
  teamName: string,
  year: number,
  position: string,
): Promise<string> {
  const response = await client.responses.create({
    model: 'gpt-4.1',
    tools: [{ type: 'web_search' as const }],
    input: `Search for photos of MLB ${position} ${playerName} who played for the ${teamName} around ${year}. Based on photos from that era, describe their appearance in a brief comma-separated list: race/ethnicity, skin tone (be specific — light, medium, dark), face shape, build, facial hair, hair style, and any distinctive features that would help identify them in a portrait. Keep it factual and concise. ONLY the list.`,
  });
  return response.output_text?.trim() ?? 'unknown appearance';
}

async function validatePortraitTest(
  client: OpenAI,
  imageBuffer: Buffer,
  playerName: string,
  teamName: string,
  year: number,
  position: string,
  description: string,
): Promise<{ pass: boolean; reason: string }> {
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

  const text = response.output_text?.trim() ?? '';
  const jsonStr = text.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
  const parsed = JSON.parse(jsonStr);
  return { pass: Boolean(parsed.pass), reason: String(parsed.reason ?? '') };
}

interface TestCase {
  file: string;
  name: string;
  team: string;
  year: number;
  position: string;
}

const GOOD: TestCase[] = [
  { file: 'good/rodrial01.webp', name: 'Alex Rodriguez', team: 'Seattle Mariners', year: 1998, position: 'shortstop' },
  { file: 'good/jonesch06.webp', name: 'Chipper Jones', team: 'Atlanta Braves', year: 1999, position: 'third baseman' },
  { file: 'good/gordode01.webp', name: 'Dee Gordon', team: 'Miami Marlins', year: 2015, position: 'second baseman' },
  { file: 'good/giambja01.webp', name: 'Jason Giambi', team: 'Oakland Athletics', year: 2001, position: 'first baseman' },
  { file: 'good/altuvjo01.webp', name: 'Jose Altuve', team: 'Houston Astros', year: 2017, position: 'second baseman' },
];

const BAD: TestCase[] = [
  { file: 'bad/raineti01.webp', name: 'Tim Raines', team: 'Montreal Expos', year: 1986, position: 'outfielder' },
  { file: 'bad/beltrad01.webp', name: 'Adrian Beltre', team: 'Los Angeles Dodgers', year: 2003, position: 'third baseman' },
  { file: 'bad/alomaro01.webp', name: 'Roberto Alomar', team: 'Cleveland Indians', year: 1999, position: 'second baseman' },
];

describe.runIf(HAS_API_KEY)('portrait validation pipeline', () => {
  const client = HAS_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

  for (const tc of GOOD) {
    it(`should PASS: ${tc.name}`, async () => {
      const imgBuffer = fs.readFileSync(path.join(FIXTURES_DIR, tc.file));
      const desc = await describePlayerTest(client!, tc.name, tc.team, tc.year, tc.position);
      const result = await validatePortraitTest(client!, imgBuffer, tc.name, tc.team, tc.year, tc.position, desc);
      console.log(`  ${tc.name}: ${result.pass ? 'PASS' : 'FAIL'} — ${result.reason}`);
      expect(result.pass).toBe(true);
    }, 60_000);
  }

  for (const tc of BAD) {
    it(`should FAIL: ${tc.name}`, async () => {
      const imgBuffer = fs.readFileSync(path.join(FIXTURES_DIR, tc.file));
      const desc = await describePlayerTest(client!, tc.name, tc.team, tc.year, tc.position);
      const result = await validatePortraitTest(client!, imgBuffer, tc.name, tc.team, tc.year, tc.position, desc);
      console.log(`  ${tc.name}: ${result.pass ? 'PASS' : 'FAIL'} — ${result.reason}`);
      expect(result.pass).toBe(false);
    }, 60_000);
  }
});
