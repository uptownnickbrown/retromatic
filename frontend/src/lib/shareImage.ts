import type { ResultsPick } from '../types';
import { safeNum } from './numeric';

const WIDTH = 1200;
const HEIGHT = 630;
const BG_COLOR = '#F9F7F1';
const NAVY = '#0A1E2F';
const MUTED = '#546E7A';
const GOLD = '#C9A84C';
const RED = '#D32F2F';

function getScoreEmoji(score: number): string {
  if (score >= 9.5) return '\u{1F7E1}'; // gold
  if (score >= 6.0) return '\u{26AA}';  // white
  return '\u{26AB}';                     // black
}

function getTierColor(score: number): string {
  if (score >= 9.5) return GOLD;
  if (score >= 7.0) return NAVY;
  return MUTED;
}

async function loadFont(): Promise<void> {
  try {
    const font = new FontFace(
      'Space Mono',
      "url(https://fonts.gstatic.com/s/spacemono/v13/i7dPIFZifjKcF5UAWdDRYEF8RQ.woff2)",
      { weight: '700' },
    );
    const loaded = await font.load();
    document.fonts.add(loaded);
  } catch {
    // Font loading failed; canvas will fall back to monospace
  }
}

export async function generateShareImage(opts: {
  totalScore: number;
  percentile: number;
  picks: ResultsPick[];
  date: string;
}): Promise<Blob> {
  await loadFont();

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle border
  ctx.strokeStyle = `${NAVY}20`;
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, WIDTH - 40, HEIGHT - 40);

  // Inner border
  ctx.strokeStyle = `${NAVY}10`;
  ctx.lineWidth = 1;
  ctx.strokeRect(28, 28, WIDTH - 56, HEIGHT - 56);

  // Masthead
  ctx.fillStyle = NAVY;
  ctx.font = '700 56px "Playfair Display", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('SANDLOT', WIDTH / 2, 100);

  // Divider
  const divY = 120;
  const gradient = ctx.createLinearGradient(200, divY, WIDTH - 200, divY);
  gradient.addColorStop(0, 'transparent');
  gradient.addColorStop(0.15, `${NAVY}33`);
  gradient.addColorStop(0.85, `${NAVY}33`);
  gradient.addColorStop(1, 'transparent');
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(200, divY);
  ctx.lineTo(WIDTH - 200, divY);
  ctx.stroke();

  // Date
  ctx.fillStyle = MUTED;
  ctx.font = '700 18px "Space Mono", monospace';
  ctx.fillText(opts.date, WIDTH / 2, 150);

  // Score badge (large circle)
  const badgeCX = WIDTH / 2;
  const badgeCY = 280;
  const badgeR = 85;
  const avgScore = opts.totalScore / 10;
  const badgeColor = getTierColor(avgScore);

  // Badge circle
  ctx.beginPath();
  ctx.arc(badgeCX, badgeCY, badgeR, 0, Math.PI * 2);
  ctx.fillStyle = badgeColor;
  ctx.fill();

  // Badge score text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 52px "Space Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(opts.totalScore.toFixed(1), badgeCX, badgeCY - 4);

  // Badge label
  ctx.font = '700 12px "Space Mono", monospace';
  ctx.fillText('/100', badgeCX, badgeCY + 30);
  ctx.textBaseline = 'alphabetic';

  // Emoji grid
  const emojis = opts.picks.map(p => getScoreEmoji(safeNum(p.legendScore)));
  const emojiStr = emojis.join(' ');
  ctx.font = '32px serif';
  ctx.textAlign = 'center';
  ctx.fillText(emojiStr, WIDTH / 2, 410);

  // "Sandlot Score: XX.X/100"
  ctx.fillStyle = NAVY;
  ctx.font = '700 22px "Space Mono", monospace';
  ctx.fillText(`Sandlot Score: ${opts.totalScore.toFixed(1)}/100`, WIDTH / 2, 460);

  // Legend count
  const legendCount = opts.picks.filter(p => safeNum(p.legendScore) >= 9.5).length;
  let nextY = 495;
  if (legendCount > 0) {
    ctx.fillStyle = GOLD;
    ctx.font = '700 20px "Space Mono", monospace';
    ctx.fillText(`\u{2B50} ${legendCount}\u00D7 Sandlot Legend`, WIDTH / 2, nextY);
    nextY += 35;
  }

  // Percentile
  const pctRank = Math.max(1, 100 - Math.round(opts.percentile));
  ctx.fillStyle = RED;
  ctx.font = '700 24px "Space Mono", monospace';
  ctx.fillText(`Top ${pctRank}%`, WIDTH / 2, nextY);

  // Footer
  ctx.fillStyle = MUTED;
  ctx.font = '700 16px "Space Mono", monospace';
  ctx.fillText('playsandlot.com', WIDTH / 2, HEIGHT - 45);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
      'image/png',
    );
  });
}
