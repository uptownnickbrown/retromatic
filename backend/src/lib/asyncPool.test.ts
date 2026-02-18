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

  it('enforces the concurrency limit', async () => {
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
    // Must be exactly 2, not "at most 2" — we want to verify
    // the pool actually parallelizes (not just serializes)
    expect(maxRunning).toBe(2);
  });

  it('retries failed items and succeeds after transient errors', async () => {
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

  it('records failures after exhausting all retries', async () => {
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

  it('handles partial failures in a batch (some succeed, some fail)', async () => {
    const worker = async (n: number) => {
      if (n === 2) throw new Error(`item ${n} failed`);
      return n * 10;
    };

    const { results, failures } = await asyncPool([1, 2, 3], 3, worker, {
      retries: 0,
      backoffMs: 1,
    });

    // Items 1 and 3 should succeed
    expect(results[0]).toBe(10);
    expect(results[2]).toBe(30);
    // Item 2 should be in failures
    expect(failures).toHaveLength(1);
    expect(failures[0].item).toBe(2);
    expect(failures[0].error.message).toBe('item 2 failed');
  });

  it('calls onProgress for each completed item', async () => {
    const onProgress = vi.fn();
    const items = [1, 2, 3];
    const worker = async (n: number) => n;

    await asyncPool(items, 2, worker, { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(3);
    // All 3 items should report done out of 3 total
    expect(onProgress).toHaveBeenCalledWith(expect.any(Number), 3);
  });

  it('handles empty items array', async () => {
    const worker = async (n: number) => n;
    const { results, failures } = await asyncPool([], 3, worker);

    expect(results).toEqual([]);
    expect(failures).toHaveLength(0);
  });

  it('converts non-Error throws to Error objects in failures', async () => {
    const worker = async () => {
      throw 'string error'; // eslint-disable-line no-throw-literal
    };

    const { failures } = await asyncPool([1], 1, worker, {
      retries: 0,
      backoffMs: 1,
    });

    expect(failures[0].error).toBeInstanceOf(Error);
    expect(failures[0].error.message).toBe('string error');
  });
});
