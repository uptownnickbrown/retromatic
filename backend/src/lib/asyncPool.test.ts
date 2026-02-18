import { describe, it, expect, vi } from 'vitest';
import { asyncPool } from './asyncPool.js';

describe('asyncPool', () => {
  it('processes all items and returns results in order', async () => {
    const items = [1, 2, 3, 4, 5];
    const worker = async (n: number) => n * 2;

    const { results, failures } = await asyncPool(items, 3, worker);

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(failures).toHaveLength(0);
  });

  it('respects concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;

    const items = [1, 2, 3, 4, 5, 6];
    const worker = async (n: number) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 10));
      running--;
      return n;
    };

    await asyncPool(items, 2, worker);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('retries failed items with backoff', async () => {
    let attempts = 0;
    const worker = async (_n: number) => {
      attempts++;
      if (attempts <= 2) throw new Error('transient');
      return 'ok';
    };

    const { results, failures } = await asyncPool([1], 1, worker, {
      retries: 3,
      backoffMs: 1, // fast for testing
    });

    expect(results[0]).toBe('ok');
    expect(failures).toHaveLength(0);
    expect(attempts).toBe(3); // 2 failures + 1 success
  });

  it('records failures after exhausting retries', async () => {
    const worker = async (_n: number): Promise<string> => {
      throw new Error('permanent failure');
    };

    const { failures } = await asyncPool([1], 1, worker, {
      retries: 1,
      backoffMs: 1,
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].item).toBe(1);
    expect(failures[0].error.message).toBe('permanent failure');
  });

  it('calls onProgress callback', async () => {
    const onProgress = vi.fn();
    const items = [1, 2, 3];
    const worker = async (n: number) => n;

    await asyncPool(items, 2, worker, { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenCalledWith(1, 3);
    expect(onProgress).toHaveBeenCalledWith(2, 3);
    expect(onProgress).toHaveBeenCalledWith(3, 3);
  });

  it('handles empty items array', async () => {
    const worker = async (n: number) => n;
    const { results, failures } = await asyncPool([], 3, worker);

    expect(results).toEqual([]);
    expect(failures).toHaveLength(0);
  });

  it('handles concurrency greater than items length', async () => {
    const items = [1, 2];
    const worker = async (n: number) => n * 10;

    const { results } = await asyncPool(items, 100, worker);
    expect(results).toEqual([10, 20]);
  });

  it('converts non-Error throws to Error objects', async () => {
    const worker = async () => {
      throw 'string error';
    };

    const { failures } = await asyncPool([1], 1, worker, {
      retries: 0,
      backoffMs: 1,
    });

    expect(failures[0].error).toBeInstanceOf(Error);
    expect(failures[0].error.message).toBe('string error');
  });
});
