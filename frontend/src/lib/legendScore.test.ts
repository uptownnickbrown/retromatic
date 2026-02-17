import { describe, it, expect } from 'vitest';
import { calculateLegendScore } from './legendScore';

describe('calculateLegendScore', () => {
  it('maps MIN_Z (-2) to MIN_SCORE (1.0)', () => {
    expect(calculateLegendScore(-2)).toBe(1.0);
  });

  it('maps MAX_Z (10) to MAX_SCORE (10.0)', () => {
    expect(calculateLegendScore(10)).toBe(10.0);
  });

  it('maps z=0 (median) to approximately 2.5', () => {
    expect(calculateLegendScore(0)).toBeCloseTo(2.5, 0);
  });

  it('clamps below MIN_Z', () => {
    expect(calculateLegendScore(-5)).toBe(1.0);
    expect(calculateLegendScore(-100)).toBe(1.0);
  });

  it('clamps above MAX_Z', () => {
    expect(calculateLegendScore(15)).toBe(10.0);
    expect(calculateLegendScore(100)).toBe(10.0);
  });

  it('returns one decimal place', () => {
    const score = calculateLegendScore(3.14);
    const decimalPart = score.toString().split('.')[1];
    expect(!decimalPart || decimalPart.length <= 1).toBe(true);
  });

  it('produces monotonically increasing scores', () => {
    const scores = [-2, -1, 0, 2, 4, 6, 8, 10].map(calculateLegendScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });
});
