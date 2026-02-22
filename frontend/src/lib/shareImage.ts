import type { ResultsPick } from '../types';
import { safeNum } from './numeric';
import { getTeamFullName } from './teams';

const W = 1200;
const H = 630;

// Palette
const PAPER = '#F9F7F1';
const BONE = '#EBE7DF';
const NAVY = '#0A1E2F';
const MUTED = '#546E7A';
const GOLD = '#C9A84C';

function tierColor(score: number): string {
  if (score >= 9.5) return GOLD;
  if (score >= 6.0) return NAVY;
  return MUTED;
}

function tierDot(score: number): string {
  if (score >= 9.5) return GOLD;
  if (score >= 6.0) return BONE;
  return NAVY;
}

function tierDotStroke(score: number): string {
  if (score >= 9.5) return '#B8952F';
  if (score >= 6.0) return `${NAVY}30`;
  return `${NAVY}60`;
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawInkDivider(ctx: CanvasRenderingContext2D, y: number, x1: number, x2: number) {
  const g = ctx.createLinearGradient(x1, y, x2, y);
  g.addColorStop(0, 'transparent');
  g.addColorStop(0.12, `${NAVY}25`);
  g.addColorStop(0.88, `${NAVY}25`);
  g.addColorStop(1, 'transparent');
  ctx.strokeStyle = g;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export async function generateShareImage(opts: {
  totalScore: number;
  percentile: number;
  picks: ResultsPick[];
  date: string;
}): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // Double border (newspaper feel)
  ctx.strokeStyle = `${NAVY}18`;
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, W - 32, H - 32);
  ctx.strokeStyle = `${NAVY}0A`;
  ctx.lineWidth = 1;
  ctx.strokeRect(22, 22, W - 44, H - 44);

  // ─── LEFT COLUMN: Best pick feature ───
  const bestPick = [...opts.picks].sort((a, b) => safeNum(b.legendScore) - safeNum(a.legendScore))[0];
  const bestScore = safeNum(bestPick?.legendScore);
  const hasPortrait = bestPick?.portraitUrl;

  // Portrait card
  const cardX = 55;
  const cardY = 70;
  const cardW = 260;
  const cardH = 340;

  // Card background
  roundRect(ctx, cardX, cardY, cardW, cardH, 4);
  ctx.fillStyle = BONE;
  ctx.fill();
  ctx.strokeStyle = `${NAVY}15`;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Inner card border
  roundRect(ctx, cardX + 4, cardY + 4, cardW - 8, cardH - 8, 2);
  ctx.strokeStyle = `${NAVY}08`;
  ctx.stroke();

  // Load and draw portrait
  let portraitImg: HTMLImageElement | null = null;
  if (hasPortrait) {
    portraitImg = await loadImage(bestPick.portraitUrl!);
  }

  const portraitX = cardX + 30;
  const portraitY = cardY + 25;
  const portraitW = 200;
  const portraitH = 200;

  if (portraitImg) {
    // Clip to rounded rectangle
    ctx.save();
    roundRect(ctx, portraitX, portraitY, portraitW, portraitH, 3);
    ctx.clip();
    // Draw covering the area, cropped from top
    const scale = Math.max(portraitW / portraitImg.width, portraitH / portraitImg.height);
    const sw = portraitImg.width * scale;
    const sh = portraitImg.height * scale;
    ctx.drawImage(portraitImg, portraitX - (sw - portraitW) / 2, portraitY, sw, sh);
    ctx.restore();

    // Portrait border
    roundRect(ctx, portraitX, portraitY, portraitW, portraitH, 3);
    ctx.strokeStyle = `${NAVY}15`;
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    // Placeholder
    roundRect(ctx, portraitX, portraitY, portraitW, portraitH, 3);
    ctx.fillStyle = `${NAVY}06`;
    ctx.fill();
    ctx.strokeStyle = `${NAVY}12`;
    ctx.stroke();
    if (bestPick) {
      ctx.fillStyle = `${NAVY}20`;
      ctx.font = '900 64px "Playfair Display", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const initials = bestPick.playerName.split(' ').map(w => w[0]).join('').slice(0, 2);
      ctx.fillText(initials, portraitX + portraitW / 2, portraitY + portraitH / 2);
    }
  }

  // "BEST PICK" label
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = MUTED;
  ctx.font = '700 10px "Space Mono", monospace';
  ctx.letterSpacing = '3px';
  ctx.fillText('B E S T   P I C K', cardX + cardW / 2, portraitY + portraitH + 22);
  ctx.letterSpacing = '0px';

  // Player name
  if (bestPick) {
    ctx.fillStyle = NAVY;
    ctx.font = '900 22px "Playfair Display", Georgia, serif';
    ctx.fillText(bestPick.playerName, cardX + cardW / 2, portraitY + portraitH + 48);

    // Year + Team
    ctx.fillStyle = MUTED;
    ctx.font = '700 13px "Space Mono", monospace';
    ctx.fillText(
      `${bestPick.year} · ${getTeamFullName(bestPick.team)}`,
      cardX + cardW / 2,
      portraitY + portraitH + 67,
    );

    // Score pill
    const pillW = 70;
    const pillH = 28;
    const pillX = cardX + cardW / 2 - pillW / 2;
    const pillY = portraitY + portraitH + 78;
    roundRect(ctx, pillX, pillY, pillW, pillH, 14);
    ctx.fillStyle = tierColor(bestScore);
    ctx.fill();
    ctx.fillStyle = '#FFF';
    ctx.font = '700 15px "Space Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(bestScore.toFixed(1), cardX + cardW / 2, pillY + pillH / 2);
    ctx.textBaseline = 'alphabetic';
  }

  // ─── RIGHT COLUMN: Masthead + stats ───
  const rx = 420; // right column start
  const rCenter = (rx + W - 50) / 2;

  // SANDLOT masthead
  ctx.fillStyle = NAVY;
  ctx.font = '900 64px "Playfair Display", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('SANDLOT', rCenter, 120);

  drawInkDivider(ctx, 138, rx + 40, W - 90);

  // Date + theme line
  ctx.fillStyle = MUTED;
  ctx.font = '700 15px "Space Mono", monospace';
  ctx.fillText(opts.date, rCenter, 162);

  // ─── Score section ───
  // Big score number
  ctx.fillStyle = NAVY;
  ctx.font = '900 90px "Playfair Display", Georgia, serif';
  ctx.fillText(opts.totalScore.toFixed(1), rCenter, 270);

  // "/100" below
  ctx.fillStyle = MUTED;
  ctx.font = '700 18px "Space Mono", monospace';
  ctx.fillText('/ 100', rCenter, 296);

  // ─── Score dots row (replaces emoji) ───
  const dotR = 10;
  const dotGap = 28;
  const dotsY = 336;
  const dotsStartX = rCenter - ((opts.picks.length - 1) * dotGap) / 2;

  for (let i = 0; i < opts.picks.length; i++) {
    const score = safeNum(opts.picks[i].legendScore);
    const cx = dotsStartX + i * dotGap;

    ctx.beginPath();
    ctx.arc(cx, dotsY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = tierDot(score);
    ctx.fill();
    ctx.strokeStyle = tierDotStroke(score);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Dot legend
  ctx.fillStyle = `${MUTED}80`;
  ctx.font = '400 10px "Space Mono", monospace';
  ctx.fillText('each dot = one pick', rCenter, dotsY + 26);

  // ─── Legend count + Percentile ───
  const legendCount = opts.picks.filter(p => safeNum(p.legendScore) >= 9.5).length;
  let statY = 398;

  if (legendCount > 0) {
    ctx.fillStyle = GOLD;
    ctx.font = '700 20px "Space Mono", monospace';
    ctx.fillText(`${legendCount}\u00D7 Sandlot Legend`, rCenter, statY);
    statY += 36;
  }

  // Percentile
  const pctRank = Math.max(1, 100 - Math.round(opts.percentile));
  ctx.fillStyle = NAVY;
  ctx.font = '900 36px "Playfair Display", Georgia, serif';
  ctx.fillText(`Top ${pctRank}%`, rCenter, statY + 6);

  // ─── Lineup mini-grid (10 positions across bottom) ───
  const gridY = 480;
  const gridGap = 62;
  const gridStartX = rCenter - (9 * gridGap) / 2;

  ctx.font = '700 10px "Space Mono", monospace';
  for (let i = 0; i < opts.picks.length; i++) {
    const pick = opts.picks[i];
    const gx = gridStartX + i * gridGap;
    const score = safeNum(pick.legendScore);

    // Position label
    ctx.fillStyle = `${MUTED}90`;
    ctx.fillText(pick.position, gx, gridY);

    // Score
    ctx.fillStyle = tierColor(score);
    ctx.font = '700 14px "Space Mono", monospace';
    ctx.fillText(score.toFixed(1), gx, gridY + 18);
    ctx.font = '700 10px "Space Mono", monospace';
  }

  drawInkDivider(ctx, gridY + 32, rx + 20, W - 70);

  // ─── Footer ───
  ctx.fillStyle = MUTED;
  ctx.font = '700 14px "Space Mono", monospace';
  ctx.fillText('playsandlot.com', rCenter, H - 42);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
      'image/png',
    );
  });
}
