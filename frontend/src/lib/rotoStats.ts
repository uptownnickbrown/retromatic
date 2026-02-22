import type { ResultsPick, PerfectLineupPick } from '../types';
import { safeNum } from './numeric';

export interface RotoCategory {
  key: string;
  label: string;
  type: 'batting' | 'pitching';
  yourValue: string;
  perfectValue: string;
  winner: 'left' | 'right' | 'tie';
}

export interface RotoComparison {
  batting: RotoCategory[];
  pitching: RotoCategory[];
  leftWins: number;
  rightWins: number;
  ties: number;
}

type Pick = ResultsPick | PerfectLineupPick;

function isBatter(p: Pick): boolean {
  return (p.playerType ?? 'batter') === 'batter';
}

function sumStat(picks: Pick[], key: string): number {
  return picks.reduce((sum, p) => sum + safeNum(p.stats?.[key]), 0);
}

function computeAvg(picks: Pick[]): number {
  const batters = picks.filter(isBatter);
  const totalH = batters.reduce((sum, p) => sum + safeNum(p.stats?.['H']), 0);
  const totalAB = batters.reduce((sum, p) => sum + safeNum(p.stats?.['AB']), 0);
  return totalAB > 0 ? totalH / totalAB : 0;
}

function computeERA(picks: Pick[]): number {
  const pitchers = picks.filter(p => !isBatter(p));
  const totalER = pitchers.reduce((sum, p) => sum + safeNum(p.stats?.['ER']), 0);
  const totalIP = pitchers.reduce((sum, p) => sum + safeNum(p.stats?.['IP']), 0);
  return totalIP > 0 ? (totalER * 9) / totalIP : 0;
}

function computeWHIP(picks: Pick[]): number {
  const pitchers = picks.filter(p => !isBatter(p));
  const totalBB = pitchers.reduce((sum, p) => sum + safeNum(p.stats?.['BB']), 0);
  const totalH = pitchers.reduce((sum, p) => sum + safeNum(p.stats?.['H']), 0);
  const totalIP = pitchers.reduce((sum, p) => sum + safeNum(p.stats?.['IP']), 0);
  return totalIP > 0 ? (totalBB + totalH) / totalIP : 0;
}

function fmtAvg(val: number): string {
  return val.toFixed(3).replace(/^0/, '');
}

function fmtInt(val: number): string {
  return String(Math.round(val));
}

function fmtRate(val: number): string {
  return val.toFixed(2);
}

function winner(left: number, right: number, inverted: boolean): 'left' | 'right' | 'tie' {
  if (left === right) return 'tie';
  if (inverted) return left < right ? 'left' : 'right';
  return left > right ? 'left' : 'right';
}

export function computeRotoComparison(
  leftPicks: Pick[],
  rightPicks: Pick[],
): RotoComparison {
  const leftBatters = leftPicks.filter(isBatter);
  const rightBatters = rightPicks.filter(isBatter);

  const battingCategories: Array<{
    key: string; label: string; statKey: string;
    compute: (picks: Pick[]) => number;
    format: (v: number) => string;
    inverted: boolean;
  }> = [
    { key: 'avg', label: 'AVG', statKey: 'AVG', compute: computeAvg, format: fmtAvg, inverted: false },
    { key: 'hr', label: 'HR', statKey: 'HR', compute: (p) => sumStat(p.filter(isBatter), 'HR'), format: fmtInt, inverted: false },
    { key: 'rbi', label: 'RBI', statKey: 'RBI', compute: (p) => sumStat(p.filter(isBatter), 'RBI'), format: fmtInt, inverted: false },
    { key: 'r', label: 'Runs', statKey: 'R', compute: (p) => sumStat(p.filter(isBatter), 'R'), format: fmtInt, inverted: false },
    { key: 'sb', label: 'SB', statKey: 'SB', compute: (p) => sumStat(p.filter(isBatter), 'SB'), format: fmtInt, inverted: false },
  ];

  const pitchingCategories: Array<{
    key: string; label: string; statKey: string;
    compute: (picks: Pick[]) => number;
    format: (v: number) => string;
    inverted: boolean;
  }> = [
    { key: 'w', label: 'Wins', statKey: 'W', compute: (p) => sumStat(p.filter(pp => !isBatter(pp)), 'W'), format: fmtInt, inverted: false },
    { key: 'sv', label: 'Saves', statKey: 'SV', compute: (p) => sumStat(p.filter(pp => !isBatter(pp)), 'SV'), format: fmtInt, inverted: false },
    { key: 'k', label: 'K', statKey: 'SO', compute: (p) => sumStat(p.filter(pp => !isBatter(pp)), 'SO'), format: fmtInt, inverted: false },
    { key: 'era', label: 'ERA', statKey: 'ERA', compute: computeERA, format: fmtRate, inverted: true },
    { key: 'whip', label: 'WHIP', statKey: 'WHIP', compute: computeWHIP, format: fmtRate, inverted: true },
  ];

  let leftWins = 0;
  let rightWins = 0;
  let ties = 0;

  const hasBatters = leftBatters.length > 0 || rightBatters.length > 0;
  const hasPitchers = leftPicks.some(p => !isBatter(p)) || rightPicks.some(p => !isBatter(p));

  const batting: RotoCategory[] = hasBatters ? battingCategories.map(cat => {
    const leftVal = cat.compute(leftPicks);
    const rightVal = cat.compute(rightPicks);
    const w = winner(leftVal, rightVal, cat.inverted);
    if (w === 'left') leftWins++;
    else if (w === 'right') rightWins++;
    else ties++;
    return {
      key: cat.key,
      label: cat.label,
      type: 'batting' as const,
      yourValue: cat.format(leftVal),
      perfectValue: cat.format(rightVal),
      winner: w,
    };
  }) : [];

  const pitching: RotoCategory[] = hasPitchers ? pitchingCategories.map(cat => {
    const leftVal = cat.compute(leftPicks);
    const rightVal = cat.compute(rightPicks);
    const w = winner(leftVal, rightVal, cat.inverted);
    if (w === 'left') leftWins++;
    else if (w === 'right') rightWins++;
    else ties++;
    return {
      key: cat.key,
      label: cat.label,
      type: 'pitching' as const,
      yourValue: cat.format(leftVal),
      perfectValue: cat.format(rightVal),
      winner: w,
    };
  }) : [];

  return { batting, pitching, leftWins, rightWins, ties };
}
