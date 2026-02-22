import { describe, it, expect } from 'vitest';
import {
  getSandlotScoreLabel,
  getSandlotScoreTier,
  getSandlotScoreColor,
  getSandlotScoreBg,
} from './index';

describe('getSandlotScoreLabel', () => {
  it('returns correct labels at boundaries', () => {
    expect(getSandlotScoreLabel(10.0)).toBe('SANDLOT LEGEND');
    expect(getSandlotScoreLabel(9.5)).toBe('SANDLOT LEGEND');
    expect(getSandlotScoreLabel(9.4)).toBe('GREAT');
    expect(getSandlotScoreLabel(6.0)).toBe('GREAT');
    expect(getSandlotScoreLabel(5.9)).toBe('AVERAGE');
    expect(getSandlotScoreLabel(1.0)).toBe('AVERAGE');
  });
});

describe('getSandlotScoreTier', () => {
  it('returns correct tier classes at boundaries', () => {
    expect(getSandlotScoreTier(9.5)).toBe('tier-legendary');
    expect(getSandlotScoreTier(9.4)).toBe('tier-great');
    expect(getSandlotScoreTier(6.0)).toBe('tier-great');
    expect(getSandlotScoreTier(5.9)).toBe('tier-average');
    expect(getSandlotScoreTier(1.0)).toBe('tier-average');
  });
});

describe('getSandlotScoreColor', () => {
  it('returns correct Tailwind color classes', () => {
    expect(getSandlotScoreColor(9.5)).toBe('text-gold');
    expect(getSandlotScoreColor(6.0)).toBe('text-navy');
    expect(getSandlotScoreColor(5.9)).toBe('text-muted');
  });
});

describe('getSandlotScoreBg', () => {
  it('returns correct background classes', () => {
    expect(getSandlotScoreBg(9.5)).toContain('bg-gold');
    expect(getSandlotScoreBg(6.0)).toContain('bg-navy');
    expect(getSandlotScoreBg(1.0)).toContain('bg-muted');
  });
});
