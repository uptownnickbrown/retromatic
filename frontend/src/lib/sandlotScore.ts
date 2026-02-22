// Sandlot Score: maps position-adjusted Z-score to a 1.0-10.0 scale
// Must stay in sync with backend/src/services/sandlotScore.ts
const MIN_Z = -2;
const MAX_Z = 10;
const MIN_SCORE = 1.0;
const MAX_SCORE = 10.0;

export function calculateSandlotScore(zScorePosition: number): number {
  const clamped = Math.max(MIN_Z, Math.min(MAX_Z, zScorePosition));
  const normalized = (clamped - MIN_Z) / (MAX_Z - MIN_Z);
  const score = MIN_SCORE + normalized * (MAX_SCORE - MIN_SCORE);
  return Math.round(score * 10) / 10;
}
