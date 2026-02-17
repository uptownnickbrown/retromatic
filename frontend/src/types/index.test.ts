import { describe, it, expect } from 'vitest';
import {
  getLegendScoreLabel,
  getLegendScoreTier,
  getLegendScoreColor,
  getLegendScoreBg,
} from './index';

describe('getLegendScoreLabel', () => {
  it('returns correct labels at boundaries', () => {
    expect(getLegendScoreLabel(10.0)).toBe('LEGENDARY');
    expect(getLegendScoreLabel(9.5)).toBe('LEGENDARY');
    expect(getLegendScoreLabel(9.4)).toBe('GREAT');
    expect(getLegendScoreLabel(6.0)).toBe('GREAT');
    expect(getLegendScoreLabel(5.9)).toBe('AVERAGE');
    expect(getLegendScoreLabel(1.0)).toBe('AVERAGE');
  });
});

describe('getLegendScoreTier', () => {
  it('returns correct tier classes at boundaries', () => {
    expect(getLegendScoreTier(9.5)).toBe('tier-legendary');
    expect(getLegendScoreTier(9.4)).toBe('tier-great');
    expect(getLegendScoreTier(6.0)).toBe('tier-great');
    expect(getLegendScoreTier(5.9)).toBe('tier-average');
    expect(getLegendScoreTier(1.0)).toBe('tier-average');
  });
});

describe('getLegendScoreColor', () => {
  it('returns correct Tailwind color classes', () => {
    expect(getLegendScoreColor(9.5)).toBe('text-gold');
    expect(getLegendScoreColor(6.0)).toBe('text-navy');
    expect(getLegendScoreColor(5.9)).toBe('text-muted');
  });
});

describe('getLegendScoreBg', () => {
  it('returns correct background classes', () => {
    expect(getLegendScoreBg(9.5)).toContain('bg-gold');
    expect(getLegendScoreBg(6.0)).toContain('bg-navy');
    expect(getLegendScoreBg(1.0)).toContain('bg-muted');
  });
});
