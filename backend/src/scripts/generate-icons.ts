/**
 * One-off script to generate app icons, OG image, and optimize static assets.
 * Run: cd backend && npx tsx src/scripts/generate-icons.ts
 */
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.resolve(__dirname, '../../../frontend/public');
const PORTRAIT_SRC = path.resolve(__dirname, '../../../frontend/dist/portraits/schmimi01.png');

async function generateIcons() {
  console.log('Generating app icons from Mike Schmidt portrait...');

  // Load source portrait (1024×1536, 3:4)
  // Crop top 1024×1024 (head/shoulders area)
  const cropped = sharp(PORTRAIT_SRC).extract({
    left: 0,
    top: 0,
    width: 1024,
    height: 1024,
  });

  // Apple touch icon (180×180)
  await cropped.clone().resize(180, 180).png().toFile(path.join(PUBLIC_DIR, 'apple-touch-icon.png'));
  console.log('  apple-touch-icon.png (180×180)');

  // Favicon 32px
  await cropped.clone().resize(32, 32).png().toFile(path.join(PUBLIC_DIR, 'favicon-32.png'));
  console.log('  favicon-32.png (32×32)');

  // favicon.ico (actually just a 32px PNG renamed — browsers accept PNG favicons)
  await cropped.clone().resize(32, 32).png().toFile(path.join(PUBLIC_DIR, 'favicon.ico'));
  console.log('  favicon.ico (32×32)');

  // PWA icons
  await cropped.clone().resize(192, 192).png().toFile(path.join(PUBLIC_DIR, 'icon-192.png'));
  console.log('  icon-192.png (192×192)');

  await cropped.clone().resize(512, 512).png().toFile(path.join(PUBLIC_DIR, 'icon-512.png'));
  console.log('  icon-512.png (512×512)');
}

async function generateOgImage() {
  console.log('\nGenerating OG image (1200×630)...');

  const W = 1200;
  const H = 630;
  const PAPER = '#F9F7F1';
  const NAVY = '#0A1E2F';

  // Load and resize portrait for OG image (left side)
  const portrait = await sharp(PORTRAIT_SRC)
    .resize(280, 420, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

  // Create the OG image with SVG overlay for text
  const svgText = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@900&amp;family=Space+Mono:wght@700&amp;display=swap');
        .title { font-family: 'Georgia', serif; font-weight: 900; font-size: 96px; fill: ${NAVY}; }
        .subtitle { font-family: 'Courier New', monospace; font-weight: 700; font-size: 22px; fill: #546E7A; letter-spacing: 6px; }
        .tagline { font-family: 'Courier New', monospace; font-weight: 700; font-size: 20px; fill: ${NAVY}; }
        .url { font-family: 'Courier New', monospace; font-weight: 700; font-size: 18px; fill: #546E7A; }
      </style>
      <text x="${W / 2 + 100}" y="240" text-anchor="middle" class="title">SANDLOT</text>
      <line x1="${W / 2 - 80}" y1="270" x2="${W / 2 + 280}" y2="270" stroke="${NAVY}" stroke-opacity="0.2" stroke-width="1"/>
      <text x="${W / 2 + 100}" y="320" text-anchor="middle" class="subtitle">DAILY FANTASY BASEBALL DRAFT</text>
      <text x="${W / 2 + 100}" y="400" text-anchor="middle" class="tagline">Draft through baseball history.</text>
      <text x="${W / 2 + 100}" y="435" text-anchor="middle" class="tagline">Same slate, everyone plays.</text>
      <text x="${W / 2 + 100}" y="540" text-anchor="middle" class="url">sandlot.uptownnickbrown.com</text>
    </svg>`;

  await sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: PAPER,
    },
  })
    .composite([
      // Double border
      {
        input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <rect x="16" y="16" width="${W - 32}" height="${H - 32}" fill="none" stroke="${NAVY}" stroke-opacity="0.1" stroke-width="2" rx="4"/>
          <rect x="22" y="22" width="${W - 44}" height="${H - 44}" fill="none" stroke="${NAVY}" stroke-opacity="0.04" stroke-width="1" rx="3"/>
        </svg>`),
        top: 0,
        left: 0,
      },
      // Portrait on left
      {
        input: portrait,
        top: 105,
        left: 60,
      },
      // Portrait border
      {
        input: Buffer.from(`<svg width="284" height="424" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="282" height="422" fill="none" stroke="${NAVY}" stroke-opacity="0.12" stroke-width="1" rx="4"/>
        </svg>`),
        top: 103,
        left: 58,
      },
      // Text overlay
      {
        input: Buffer.from(svgText),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toFile(path.join(PUBLIC_DIR, 'og-image.png'));

  console.log('  og-image.png (1200×630)');
}

async function optimizeAssets() {
  console.log('\nOptimizing static assets to WebP...');

  const assets = [
    { name: 'paper-texture', ext: 'png' },
    { name: 'postmark', ext: 'png' },
    { name: 'wax-seal', ext: 'png' },
  ];

  for (const asset of assets) {
    const src = path.join(PUBLIC_DIR, `${asset.name}.${asset.ext}`);
    const dest = path.join(PUBLIC_DIR, `${asset.name}.webp`);

    if (!fs.existsSync(src)) {
      console.log(`  SKIP: ${asset.name}.${asset.ext} not found`);
      continue;
    }

    const beforeSize = fs.statSync(src).size;
    await sharp(src).webp({ quality: 90 }).toFile(dest);
    const afterSize = fs.statSync(dest).size;
    const savings = ((1 - afterSize / beforeSize) * 100).toFixed(1);

    console.log(`  ${asset.name}.webp: ${(beforeSize / 1024).toFixed(0)}KB → ${(afterSize / 1024).toFixed(0)}KB (${savings}% smaller)`);
  }

  // Delete unused files
  for (const unused of ['vite.svg', 'player.svg']) {
    const p = path.join(PUBLIC_DIR, unused);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`  Deleted: ${unused}`);
    }
  }
}

async function main() {
  await generateIcons();
  await generateOgImage();
  await optimizeAssets();
  console.log('\nDone! All assets generated in frontend/public/');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
