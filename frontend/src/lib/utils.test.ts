import { describe, it, expect } from 'vitest';
import { getOrdinalSuffix } from './utils';

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
