import { describe, it, expect } from 'vitest';
import { toNum } from './numeric.js';

describe('toNum', () => {
  it('converts string decimals to numbers', () => {
    expect(toNum('3.14')).toBe(3.14);
    expect(toNum('42')).toBe(42);
    expect(toNum('0')).toBe(0);
    expect(toNum('-1.5')).toBe(-1.5);
  });

  it('passes through numbers unchanged', () => {
    expect(toNum(7.2)).toBe(7.2);
    expect(toNum(0)).toBe(0);
    expect(toNum(-3)).toBe(-3);
  });

  it('returns fallback for null and undefined', () => {
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum(null, 50)).toBe(50);
    expect(toNum(undefined, 99)).toBe(99);
  });

  it('returns fallback for NaN-producing strings', () => {
    expect(toNum('abc')).toBe(0);
    expect(toNum('')).toBe(0);
    expect(toNum('NaN')).toBe(0);
    expect(toNum('abc', 5)).toBe(5);
  });

  it('handles edge cases', () => {
    expect(toNum('Infinity')).toBe(Infinity);
    expect(toNum('1e3')).toBe(1000);
  });
});
