import { describe, it, expect } from 'vitest';
import { safeNum } from './numeric';

describe('safeNum', () => {
  it('converts string decimals to numbers', () => {
    expect(safeNum('3.14')).toBe(3.14);
    expect(safeNum('42')).toBe(42);
    expect(safeNum('0')).toBe(0);
    expect(safeNum('-1.5')).toBe(-1.5);
  });

  it('passes through numbers unchanged', () => {
    expect(safeNum(7.2)).toBe(7.2);
    expect(safeNum(0)).toBe(0);
    expect(safeNum(-3)).toBe(-3);
  });

  it('returns fallback for null and undefined', () => {
    expect(safeNum(null)).toBe(0);
    expect(safeNum(undefined)).toBe(0);
    expect(safeNum(null, 50)).toBe(50);
    expect(safeNum(undefined, 99)).toBe(99);
  });

  it('returns fallback for NaN-producing values', () => {
    expect(safeNum('abc')).toBe(0);
    expect(safeNum('')).toBe(0);
    expect(safeNum('NaN')).toBe(0);
    expect(safeNum('abc', 5)).toBe(5);
  });

  it('handles boolean and other types', () => {
    expect(safeNum(true)).toBe(1);
    expect(safeNum(false)).toBe(0);
  });
});
