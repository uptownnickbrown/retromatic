import type { ResultsPick } from '../types';
import { POSITIONS } from '../types';
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

function tierEmoji(score: number): string {
  if (score >= 9.5) return '\u{1F3C6}';  // 🏆
  if (score >= 6.0) return '\u{26BE}';   // ⚾
  return '\u{1F95C}';                    // 🥜
}

/** Sort picks into canonical position order (C, 1B, 2B, SS, 3B, OF, UTIL, SP, RP, P) */
function sortByPosition(picks: ResultsPick[]): ResultsPick[] {
  return [...picks].sort(
    (a, b) => POSITIONS.indexOf(a.position as typeof POSITIONS[number]) - POSITIONS.indexOf(b.position as typeof POSITIONS[number]),
  );
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

  const sortedPicks = sortByPosition(opts.picks);

  // Background
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // Double border
  ctx.strokeStyle = `${NAVY}18`;
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, W - 32, H - 32);
  ctx.strokeStyle = `${NAVY}0A`;
  ctx.lineWidth = 1;
  ctx.strokeRect(22, 22, W - 44, H - 44);

  // ─── LEFT COLUMN: Best pick feature ───
  const bestPick = [...opts.picks].sort((a, b) => safeNum(b.legendScore) - safeNum(a.legendScore))[0];
  const bestScore = safeNum(bestPick?.legendScore);

  const cardX = 50;
  const cardY = 55;
  const cardW = 300;
  const cardH = 520;

  // Card background
  roundRect(ctx, cardX, cardY, cardW, cardH, 5);
  ctx.fillStyle = BONE;
  ctx.fill();
  ctx.strokeStyle = `${NAVY}15`;
  ctx.lineWidth = 1;
  ctx.stroke();
  roundRect(ctx, cardX + 5, cardY + 5, cardW - 10, cardH - 10, 3);
  ctx.strokeStyle = `${NAVY}08`;
  ctx.stroke();

  // Portrait
  let portraitImg: HTMLImageElement | null = null;
  if (bestPick?.portraitUrl) {
    portraitImg = await loadImage(bestPick.portraitUrl);
  }

  const portraitX = cardX + 40;
  const portraitY = cardY + 30;
  const portraitW = 220;
  const portraitH = 260;

  if (portraitImg) {
    ctx.save();
    roundRect(ctx, portraitX, portraitY, portraitW, portraitH, 4);
    ctx.clip();
    const scale = Math.max(portraitW / portraitImg.width, portraitH / portraitImg.height);
    const sw = portraitImg.width * scale;
    const sh = portraitImg.height * scale;
    ctx.drawImage(portraitImg, portraitX - (sw - portraitW) / 2, portraitY, sw, sh);
    ctx.restore();
    roundRect(ctx, portraitX, portraitY, portraitW, portraitH, 4);
    ctx.strokeStyle = `${NAVY}15`;
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    roundRect(ctx, portraitX, portraitY, portraitW, portraitH, 4);
    ctx.fillStyle = `${NAVY}06`;
    ctx.fill();
    ctx.strokeStyle = `${NAVY}12`;
    ctx.stroke();
    if (bestPick) {
      ctx.fillStyle = `${NAVY}20`;
      ctx.font = '900 80px "Playfair Display", Georgia, serif';
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
  ctx.font = '700 12px "Space Mono", monospace';
  ctx.letterSpacing = '4px';
  ctx.fillText('B E S T   P I C K', cardX + cardW / 2, portraitY + portraitH + 28);
  ctx.letterSpacing = '0px';

  if (bestPick) {
    // Player name — large
    ctx.fillStyle = NAVY;
    ctx.font = '900 28px "Playfair Display", Georgia, serif';
    ctx.fillText(bestPick.playerName, cardX + cardW / 2, portraitY + portraitH + 62);

    // Year + Team
    ctx.fillStyle = MUTED;
    ctx.font = '700 16px "Space Mono", monospace';
    ctx.fillText(
      `${bestPick.year} \u00B7 ${getTeamFullName(bestPick.team)}`,
      cardX + cardW / 2,
      portraitY + portraitH + 86,
    );

    // Score pill
    const pillW = 90;
    const pillH = 36;
    const pillX = cardX + cardW / 2 - pillW / 2;
    const pillY = portraitY + portraitH + 100;
    roundRect(ctx, pillX, pillY, pillW, pillH, 18);
    ctx.fillStyle = tierColor(bestScore);
    ctx.fill();
    ctx.fillStyle = '#FFF';
    ctx.font = '700 20px "Space Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(bestScore.toFixed(1), cardX + cardW / 2, pillY + pillH / 2);
    ctx.textBaseline = 'alphabetic';
  }

  // ─── CENTER COLUMN ───
  const cx = 420;
  const centerX = 640;

  // SANDLOT masthead
  ctx.fillStyle = NAVY;
  ctx.font = '900 80px "Playfair Display", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('SANDLOT', centerX, 120);

  drawInkDivider(ctx, 140, cx, 860);

  // Date
  ctx.fillStyle = MUTED;
  ctx.font = '700 20px "Space Mono", monospace';
  ctx.fillText(opts.date, centerX, 174);

  // Big score
  ctx.fillStyle = NAVY;
  ctx.font = '900 120px "Playfair Display", Georgia, serif';
  ctx.fillText(opts.totalScore.toFixed(1), centerX, 310);

  // "/100"
  ctx.fillStyle = MUTED;
  ctx.font = '700 26px "Space Mono", monospace';
  ctx.fillText('/ 100', centerX, 346);

  // Legend count + Percentile
  const legendCount = opts.picks.filter(p => safeNum(p.legendScore) >= 9.5).length;
  let statY = 400;

  if (legendCount > 0) {
    ctx.fillStyle = GOLD;
    ctx.font = '700 26px "Space Mono", monospace';
    ctx.fillText(
      `${legendCount} Sandlot Legend${legendCount > 1 ? 's' : ''}`,
      centerX,
      statY,
    );
    statY += 50;
  }

  // Percentile
  const pctRank = Math.max(1, Math.round(opts.percentile));
  ctx.fillStyle = NAVY;
  ctx.font = '900 48px "Playfair Display", Georgia, serif';
  ctx.fillText(`Better than ${pctRank}%`, centerX, statY + 8);

  // ─── RIGHT COLUMN: Lineup with emojis ───
  const rX = 920; // left edge of lineup column
  const lineupTop = 70;
  const lineupRowH = 50;

  ctx.textAlign = 'left';

  for (let i = 0; i < sortedPicks.length; i++) {
    const pick = sortedPicks[i];
    const score = safeNum(pick.legendScore);
    const rowY = lineupTop + i * lineupRowH;

    // Position label
    ctx.fillStyle = `${MUTED}CC`;
    ctx.font = '700 14px "Space Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(pick.position.padEnd(4), rX, rowY + lineupRowH / 2);

    // Emoji
    ctx.font = '20px serif';
    ctx.fillText(tierEmoji(score), rX + 60, rowY + lineupRowH / 2);

    // Score
    ctx.fillStyle = tierColor(score);
    ctx.font = '700 20px "Space Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(score.toFixed(1), W - 50, rowY + lineupRowH / 2);
    ctx.textAlign = 'left';
  }

  // ─── Footer ───
  drawInkDivider(ctx, H - 54, 40, W - 40);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = NAVY;
  ctx.font = '700 22px "Space Mono", monospace';
  ctx.fillText('sandlot.uptownnickbrown.com', W / 2, H - 36);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
      'image/png',
    );
  });
}
