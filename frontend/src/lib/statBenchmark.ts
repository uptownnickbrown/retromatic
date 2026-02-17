// Z-score → percentile using normal CDF approximation (Abramowitz & Stegun)
export function zToPercentile(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  const cdf = 0.5 * (1.0 + sign * y);
  return Math.round(cdf * 100);
}

export interface StatConfig {
  key: string;        // key in categoryZscores (or stats for AVG/ERA display)
  label: string;      // display label
  statKey: string;    // key in stats record for the raw value
  format: (v: number) => string;  // how to display the raw stat value
  hasPercentile: boolean;  // whether we have a Z-score for this stat
  inverted?: boolean; // lower is better (ERA, WHIP)
}

const fmtInt = (v: number) => String(Math.round(v));
const fmtAvg = (v: number) => v.toFixed(3).replace(/^0/, '');
const fmtEra = (v: number) => v.toFixed(2);

export function getDisplayStats(playerType: 'batter' | 'pitcher'): StatConfig[] {
  if (playerType === 'batter') {
    return [
      { key: 'AVG', label: 'AVG', statKey: 'AVG', format: fmtAvg, hasPercentile: true },
      { key: 'HR', label: 'HR', statKey: 'HR', format: fmtInt, hasPercentile: true },
      { key: 'RBI', label: 'RBI', statKey: 'RBI', format: fmtInt, hasPercentile: true },
      { key: 'R', label: 'Runs', statKey: 'R', format: fmtInt, hasPercentile: true },
      { key: 'SB', label: 'SB', statKey: 'SB', format: fmtInt, hasPercentile: true },
    ];
  }
  return [
    { key: 'W', label: 'Wins', statKey: 'W', format: fmtInt, hasPercentile: true },
    { key: 'SV', label: 'Saves', statKey: 'SV', format: fmtInt, hasPercentile: true },
    { key: 'K', label: 'K', statKey: 'SO', format: fmtInt, hasPercentile: true },
    { key: 'ERA', label: 'ERA', statKey: 'ERA', format: fmtEra, hasPercentile: true, inverted: true },
    { key: 'WHIP', label: 'WHIP', statKey: 'WHIP', format: fmtEra, hasPercentile: true, inverted: true },
  ];
}
