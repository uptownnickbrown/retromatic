import { describe, it, expect } from 'vitest';
import { getOrdinalSuffix, formatNumber, getStarRating, getStarLabel } from './utils';

describe('getOrdinalSuffix', () => {
  it('handles 1st, 2nd, 3rd', () => {
    expect(getOrdinalSuffix(1)).toBe('1st');
    expect(getOrdinalSuffix(2)).toBe('2nd');
    expect(getOrdinalSuffix(3)).toBe('3rd');
  });

  it('handles 4th-20th (all "th")', () => {
    expect(getOrdinalSuffix(4)).toBe('4th');
    expect(getOrdinalSuffix(10)).toBe('10th');
    expect(getOrdinalSuffix(11)).toBe('11th');
    expect(getOrdinalSuffix(12)).toBe('12th');
    expect(getOrdinalSuffix(13)).toBe('13th');
    expect(getOrdinalSuffix(20)).toBe('20th');
  });

  it('handles 21st, 22nd, 23rd', () => {
    expect(getOrdinalSuffix(21)).toBe('21st');
    expect(getOrdinalSuffix(22)).toBe('22nd');
    expect(getOrdinalSuffix(23)).toBe('23rd');
  });

  it('handles 100+', () => {
    expect(getOrdinalSuffix(100)).toBe('100th');
    expect(getOrdinalSuffix(101)).toBe('101st');
    expect(getOrdinalSuffix(111)).toBe('111th');
    expect(getOrdinalSuffix(112)).toBe('112th');
  });
});

describe('formatNumber', () => {
  it('formats small numbers without separators', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(42)).toBe('42');
    expect(formatNumber(999)).toBe('999');
  });

  it('formats thousands with comma separators', () => {
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(12345)).toBe('12,345');
    expect(formatNumber(1000000)).toBe('1,000,000');
  });

  it('formats negative numbers', () => {
    expect(formatNumber(-500)).toMatch('-500');
    expect(formatNumber(-1234)).toMatch(/^-?1,?234$/);
  });
});

describe('getStarRating', () => {
  it('returns 5 for elite z-scores (> 2.0)', () => {
    expect(getStarRating(2.1)).toBe(5);
    expect(getStarRating(3.5)).toBe(5);
  });

  it('returns 4 for all-star z-scores (> 1.0)', () => {
    expect(getStarRating(1.1)).toBe(4);
    expect(getStarRating(2.0)).toBe(4);
  });

  it('returns 3 for solid z-scores (> 0.0)', () => {
    expect(getStarRating(0.1)).toBe(3);
    expect(getStarRating(1.0)).toBe(3);
  });

  it('returns 2 for average z-scores (> -1.0)', () => {
    expect(getStarRating(-0.5)).toBe(2);
    expect(getStarRating(-0.9)).toBe(2);
  });

  it('returns 1 for below average z-scores (<= -1.0)', () => {
    expect(getStarRating(-1.1)).toBe(1);
    expect(getStarRating(-3.0)).toBe(1);
  });

  it('handles exact boundary values', () => {
    expect(getStarRating(-1.0)).toBe(1); // not > -1.0, so not 2
    expect(getStarRating(0.0)).toBe(2);  // not > 0.0, so not 3
    expect(getStarRating(1.0)).toBe(3);  // not > 1.0, so not 4
    expect(getStarRating(2.0)).toBe(4);  // not > 2.0, so not 5
  });
});

describe('getStarLabel', () => {
  it('returns correct labels for each star rating', () => {
    expect(getStarLabel(5)).toBe('Elite');
    expect(getStarLabel(4)).toBe('All-Star');
    expect(getStarLabel(3)).toBe('Solid');
    expect(getStarLabel(2)).toBe('Average');
    expect(getStarLabel(1)).toBe('Below Average');
  });

  it('returns Below Average for unexpected values', () => {
    expect(getStarLabel(0)).toBe('Below Average');
    expect(getStarLabel(6)).toBe('Below Average');
  });
});
