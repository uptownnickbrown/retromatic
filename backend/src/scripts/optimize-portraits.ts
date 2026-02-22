/**
 * One-time script to convert existing .png portraits to optimized .webp.
 *
 * Usage (local):   npx tsx src/scripts/optimize-portraits.ts
 * Usage (Railway): railway run node dist/scripts/optimize-portraits.js
 *
 * Steps:
 * 1. Read all .png files from PORTRAIT_DIR
 * 2. Resize to 200px height, convert to WebP (quality 80)
 * 3. Save .webp alongside original
 * 4. Update round_options.portrait_url in DB (.png → .webp)
 * 5. Delete old .png files
 */
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

// Target background color
const CREAM_R = 0xFC, CREAM_G = 0xED, CREAM_B = 0xCD; // #FCEDCD
const BG_THRESHOLD = 40;

const PORTRAITS_DIR = process.env.PORTRAIT_DIR
  || path.resolve(
    import.meta.dirname ?? process.cwd(),
    '../../../frontend/public/portraits',
  );

const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://retromatic:retromatic_dev@localhost:5432/retromatic';

async function optimizePortraits() {
  console.log(`[optimize-portraits] Portrait dir: ${PORTRAITS_DIR}`);

  if (!fs.existsSync(PORTRAITS_DIR)) {
    console.log('[optimize-portraits] No portrait directory found, nothing to do.');
    return;
  }

  // Find all .png files
  const pngFiles = fs.readdirSync(PORTRAITS_DIR).filter(f => f.endsWith('.png'));
  console.log(`[optimize-portraits] Found ${pngFiles.length} PNG files to convert`);

  if (pngFiles.length === 0) return;

  let converted = 0;
  let failed = 0;

  for (const pngFile of pngFiles) {
    const pngPath = path.join(PORTRAITS_DIR, pngFile);
    const webpFile = pngFile.replace(/\.png$/, '.webp');
    const webpPath = path.join(PORTRAITS_DIR, webpFile);

    try {
      const pngSize = fs.statSync(pngPath).size;

      const { data, info } = await sharp(pngPath)
        .resize({ height: 200 })
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Normalize background to exact cream
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

      await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } })
        .webp({ quality: 90 })
        .toFile(webpPath);

      const webpSize = fs.statSync(webpPath).size;
      const reduction = ((1 - webpSize / pngSize) * 100).toFixed(1);

      // Delete original png
      fs.unlinkSync(pngPath);

      console.log(`  ✓ ${pngFile} → ${webpFile} (${(pngSize / 1024).toFixed(0)}KB → ${(webpSize / 1024).toFixed(0)}KB, -${reduction}%)`);
      converted++;
    } catch (err) {
      console.error(`  ✗ ${pngFile}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`[optimize-portraits] Converted: ${converted}, Failed: ${failed}`);

  // Update DB URLs: .png → .webp
  const sql = postgres(DATABASE_URL);
  try {
    const result = await sql`
      UPDATE round_options
      SET portrait_url = REGEXP_REPLACE(portrait_url, '\.png', '.webp')
      WHERE portrait_url LIKE '%.png%'
    `;
    console.log(`[optimize-portraits] Updated ${result.count} DB rows (.png → .webp)`);
  } finally {
    await sql.end();
  }

  console.log('[optimize-portraits] Done.');
}

optimizePortraits().catch(err => {
  console.error('[optimize-portraits] FAILED:', err);
  process.exitCode = 1;
});
