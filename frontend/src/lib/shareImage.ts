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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
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

  // ─── Left card: text area below portrait ───
  // Layout: portrait ends at portraitY+portraitH, card ends at cardY+cardH
  // Target: score pill ~30px from card bottom, label/name/team evenly spaced above
  const textTop = portraitY + portraitH + 12;
  const cardBottom = cardY + cardH;
  const pillH = 40;
  const pillW = 96;
  const pillY = cardBottom - 30 - pillH;
  const textZone = pillY - textTop; // space for label + name + team

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Dynamic label: "SANDLOT LEGEND" or "BEST PICK"
  const labelY = textTop + textZone * 0.22;
  if (bestScore >= 9.5) {
    ctx.fillStyle = GOLD;
    ctx.font = '900 15px "Playfair Display", Georgia, serif';
    ctx.letterSpacing = '4px';
    ctx.fillText('SANDLOT LEGEND', cardX + cardW / 2, labelY);
  } else {
    ctx.fillStyle = MUTED;
    ctx.font = '700 14px "Space Mono", monospace';
    ctx.letterSpacing = '4px';
    ctx.fillText('BEST PICK', cardX + cardW / 2, labelY);
  }
  ctx.letterSpacing = '0px';

  if (bestPick) {
    // Player name
    ctx.fillStyle = NAVY;
    ctx.font = '900 30px "Playfair Display", Georgia, serif';
    ctx.fillText(bestPick.playerName, cardX + cardW / 2, textTop + textZone * 0.55);

    // Team
    ctx.fillStyle = MUTED;
    ctx.font = '700 17px "Space Mono", monospace';
    ctx.fillText(getTeamFullName(bestPick.team), cardX + cardW / 2, textTop + textZone * 0.82);

    // Score pill — near bottom of card
    const pillX = cardX + cardW / 2 - pillW / 2;
    roundRect(ctx, pillX, pillY, pillW, pillH, 20);
    ctx.fillStyle = tierColor(bestScore);
    ctx.fill();
    ctx.fillStyle = '#FFF';
    ctx.font = '700 22px "Space Mono", monospace';
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

  // Big score
  ctx.fillStyle = NAVY;
  ctx.font = '900 120px "Playfair Display", Georgia, serif';
  ctx.fillText(opts.totalScore.toFixed(1), centerX, 290);

  // Percentile (ordinal format)
  const pctRank = Math.max(1, Math.round(opts.percentile));
  ctx.fillStyle = NAVY;
  ctx.font = '900 48px "Playfair Display", Georgia, serif';
  ctx.fillText(`${ordinal(pctRank)} Percentile`, centerX, 388);

  // Footer — URL · date, centered as a unit
  ctx.fillStyle = NAVY;
  ctx.font = '700 26px "Space Mono", monospace';
  const url = 'sandlot.uptownnickbrown.com';
  const sep = ' · ';
  const footerText = `${url}${sep}${opts.date}`;
  ctx.fillText(footerText, centerX, H - 50);

  // ─── RIGHT COLUMN: Lineup ───
  const lineupTop = 70;
  const lineupRowH = 50;
  const lineupRight = W - 50;

  ctx.textAlign = 'left';

  for (let i = 0; i < sortedPicks.length; i++) {
    const pick = sortedPicks[i];
    const score = safeNum(pick.legendScore);
    const rowY = lineupTop + i * lineupRowH;
    const isLegend = score >= 9.5;

    // Gold highlight bar for legend rows — just around position + score
    if (isLegend) {
      const hlLeft = lineupRight - 120;
      roundRect(ctx, hlLeft, rowY + 4, lineupRight - hlLeft + 12, lineupRowH - 8, 4);
      ctx.fillStyle = `${GOLD}1F`; // ~12% opacity
      ctx.fill();
    }

    // Position label — right-aligned, close to score
    ctx.fillStyle = isLegend ? GOLD : `${MUTED}CC`;
    ctx.font = '700 18px "Space Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(pick.position, lineupRight - 80, rowY + lineupRowH / 2);

    // Score
    ctx.fillStyle = isLegend ? GOLD : tierColor(score);
    ctx.font = '700 24px "Space Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(score.toFixed(1), lineupRight, rowY + lineupRowH / 2);
    ctx.textAlign = 'left';
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
      'image/png',
    );
  });
}
