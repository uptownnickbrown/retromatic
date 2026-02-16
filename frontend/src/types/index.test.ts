import { describe, it, expect } from 'vitest';
import {
  getLegendScoreLabel,
  getLegendScoreTier,
  getLegendScoreColor,
  getLegendScoreBg,
} from './index';

describe('getLegendScoreLabel', () => {
  it('returns correct labels at boundaries', () => {
    expect(getLegendScoreLabel(9.5)).toBe('LEGENDARY');
    expect(getLegendScoreLabel(9.4)).toBe('ELITE');
    expect(getLegendScoreLabel(8.5)).toBe('ELITE');
    expect(getLegendScoreLabel(8.4)).toBe('ALL-STAR');
    expect(getLegendScoreLabel(7.0)).toBe('ALL-STAR');
    expect(getLegendScoreLabel(6.9)).toBe('SOLID');
    expect(getLegendScoreLabel(5.0)).toBe('SOLID');
    expect(getLegendScoreLabel(4.9)).toBe('AVERAGE');
    expect(getLegendScoreLabel(3.0)).toBe('AVERAGE');
    expect(getLegendScoreLabel(2.9)).toBe('BENCH');
    expect(getLegendScoreLabel(1.0)).toBe('BENCH');
  });
});

describe('getLegendScoreTier', () => {
  it('returns correct tier classes at boundaries', () => {
    expect(getLegendScoreTier(9.5)).toBe('legend-legendary');
    expect(getLegendScoreTier(9.4)).toBe('legend-elite');
    expect(getLegendScoreTier(8.5)).toBe('legend-elite');
    expect(getLegendScoreTier(7.0)).toBe('legend-allstar');
    expect(getLegendScoreTier(5.0)).toBe('legend-solid');
    expect(getLegendScoreTier(3.0)).toBe('legend-average');
    expect(getLegendScoreTier(2.9)).toBe('legend-bench');
  });
});

describe('getLegendScoreColor', () => {
  it('returns correct Tailwind color classes', () => {
    expect(getLegendScoreColor(9.0)).toBe('text-yellow-400');
    expect(getLegendScoreColor(7.0)).toBe('text-emerald-400');
    expect(getLegendScoreColor(5.0)).toBe('text-blue-400');
    expect(getLegendScoreColor(3.0)).toBe('text-orange-400');
    expect(getLegendScoreColor(2.9)).toBe('text-red-400');
  });
});

describe('getLegendScoreBg', () => {
  it('returns correct background classes', () => {
    expect(getLegendScoreBg(9.0)).toContain('bg-yellow');
    expect(getLegendScoreBg(7.0)).toContain('bg-emerald');
    expect(getLegendScoreBg(5.0)).toContain('bg-blue');
    expect(getLegendScoreBg(3.0)).toContain('bg-orange');
    expect(getLegendScoreBg(1.0)).toContain('bg-red');
  });
});
