import { describe, it, expect } from 'vitest';
import { calculateLegendScore, getLegendScoreLabel, getLegendScoreColor } from './legendScore.js';

describe('calculateLegendScore', () => {
  it('maps MIN_Z (-2) to MIN_SCORE (1.0)', () => {
    expect(calculateLegendScore(-2)).toBe(1.0);
  });

  it('maps MAX_Z (10) to MAX_SCORE (10.0)', () => {
    expect(calculateLegendScore(10)).toBe(10.0);
  });

  it('maps z=0 (median) to approximately 2.5', () => {
    const score = calculateLegendScore(0);
    expect(score).toBeCloseTo(2.5, 0);
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

describe('getLegendScoreLabel', () => {
  it('returns correct labels at boundaries', () => {
    expect(getLegendScoreLabel(9.5)).toBe('Legendary');
    expect(getLegendScoreLabel(9.4)).toBe('Elite');
    expect(getLegendScoreLabel(8.5)).toBe('Elite');
    expect(getLegendScoreLabel(8.4)).toBe('All-Star');
    expect(getLegendScoreLabel(7.0)).toBe('All-Star');
    expect(getLegendScoreLabel(6.9)).toBe('Solid');
    expect(getLegendScoreLabel(5.0)).toBe('Solid');
    expect(getLegendScoreLabel(4.9)).toBe('Average');
    expect(getLegendScoreLabel(3.0)).toBe('Average');
    expect(getLegendScoreLabel(2.9)).toBe('Below Average');
    expect(getLegendScoreLabel(1.0)).toBe('Below Average');
  });
});

describe('getLegendScoreColor', () => {
  it('returns correct colors at boundaries', () => {
    expect(getLegendScoreColor(9.0)).toBe('gold');
    expect(getLegendScoreColor(8.9)).toBe('green');
    expect(getLegendScoreColor(7.0)).toBe('green');
    expect(getLegendScoreColor(6.9)).toBe('neutral');
    expect(getLegendScoreColor(5.0)).toBe('neutral');
    expect(getLegendScoreColor(4.9)).toBe('yellow');
    expect(getLegendScoreColor(3.0)).toBe('yellow');
    expect(getLegendScoreColor(2.9)).toBe('red');
  });
});
