import { describe, it, expect } from 'vitest';
import { calculateSandlotScore, getSandlotScoreLabel, getSandlotScoreColor } from './sandlotScore.js';

describe('calculateSandlotScore', () => {
  it('maps MIN_Z (-2) to MIN_SCORE (1.0)', () => {
    expect(calculateSandlotScore(-2)).toBe(1.0);
  });

  it('maps MAX_Z (10) to MAX_SCORE (10.0)', () => {
    expect(calculateSandlotScore(10)).toBe(10.0);
  });

  it('maps z=0 (median) to approximately 2.5', () => {
    const score = calculateSandlotScore(0);
    expect(score).toBeCloseTo(2.5, 0);
  });

  it('clamps below MIN_Z', () => {
    expect(calculateSandlotScore(-5)).toBe(1.0);
    expect(calculateSandlotScore(-100)).toBe(1.0);
  });

  it('clamps above MAX_Z', () => {
    expect(calculateSandlotScore(15)).toBe(10.0);
    expect(calculateSandlotScore(100)).toBe(10.0);
  });

  it('returns one decimal place', () => {
    const score = calculateSandlotScore(3.14);
    const decimalPart = score.toString().split('.')[1];
    expect(!decimalPart || decimalPart.length <= 1).toBe(true);
  });

  it('produces monotonically increasing scores', () => {
    const scores = [-2, -1, 0, 2, 4, 6, 8, 10].map(calculateSandlotScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });
});

describe('getSandlotScoreLabel', () => {
  it('returns correct labels at boundaries', () => {
    expect(getSandlotScoreLabel(9.5)).toBe('Sandlot Legend');
    expect(getSandlotScoreLabel(9.4)).toBe('Elite');
    expect(getSandlotScoreLabel(8.5)).toBe('Elite');
    expect(getSandlotScoreLabel(8.4)).toBe('All-Star');
    expect(getSandlotScoreLabel(7.0)).toBe('All-Star');
    expect(getSandlotScoreLabel(6.9)).toBe('Solid');
    expect(getSandlotScoreLabel(5.0)).toBe('Solid');
    expect(getSandlotScoreLabel(4.9)).toBe('Average');
    expect(getSandlotScoreLabel(3.0)).toBe('Average');
    expect(getSandlotScoreLabel(2.9)).toBe('Below Average');
    expect(getSandlotScoreLabel(1.0)).toBe('Below Average');
  });
});

describe('getSandlotScoreColor', () => {
  it('returns correct colors at boundaries', () => {
    expect(getSandlotScoreColor(9.0)).toBe('gold');
    expect(getSandlotScoreColor(8.9)).toBe('green');
    expect(getSandlotScoreColor(7.0)).toBe('green');
    expect(getSandlotScoreColor(6.9)).toBe('neutral');
    expect(getSandlotScoreColor(5.0)).toBe('neutral');
    expect(getSandlotScoreColor(4.9)).toBe('yellow');
    expect(getSandlotScoreColor(3.0)).toBe('yellow');
    expect(getSandlotScoreColor(2.9)).toBe('red');
  });
});
