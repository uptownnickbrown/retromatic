import { describe, it, expect } from 'vitest';
import { parseId } from './validation.js';

describe('parseId', () => {
  it('parses valid positive integers', () => {
    expect(parseId('1')).toBe(1);
    expect(parseId('42')).toBe(42);
    expect(parseId('999')).toBe(999);
  });

  it('returns null for non-numeric strings', () => {
    expect(parseId('abc')).toBeNull();
    expect(parseId('')).toBeNull();
    expect(parseId('NaN')).toBeNull();
  });

  it('returns null for zero', () => {
    expect(parseId('0')).toBeNull();
  });

  it('returns null for negative numbers', () => {
    expect(parseId('-1')).toBeNull();
    expect(parseId('-100')).toBeNull();
  });

  it('truncates floats to integer part', () => {
    expect(parseId('3.7')).toBe(3);
    expect(parseId('1.0')).toBe(1);
  });
});
