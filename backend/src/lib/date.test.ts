import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTodayET } from './date.js';

describe('getTodayET', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a date string in YYYY-MM-DD format', () => {
    const result = getTodayET();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the correct ET date when UTC is ahead of midnight ET', () => {
    // 2024-03-15 at 3:00 UTC = 2024-03-14 at 11:00 PM ET (EST, UTC-5)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-15T03:00:00Z'));

    const result = getTodayET();
    expect(result).toBe('2024-03-14');
  });

  it('returns the correct ET date when UTC matches ET date', () => {
    // 2024-07-04 at 18:00 UTC = 2024-07-04 at 2:00 PM ET (EDT, UTC-4)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-07-04T18:00:00Z'));

    const result = getTodayET();
    expect(result).toBe('2024-07-04');
  });

  it('handles DST transition correctly', () => {
    // Spring forward: 2024-03-10 at 7:00 UTC = 2024-03-10 at 3:00 AM EDT
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-10T07:00:00Z'));

    const result = getTodayET();
    expect(result).toBe('2024-03-10');
  });
});
