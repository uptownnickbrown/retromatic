/**
 * Concurrent worker pool with retries and progress tracking.
 * Used for parallel OpenAI API calls (blurbs, portraits, themed gen).
 */

export interface AsyncPoolOptions {
  retries?: number;       // Default 3
  backoffMs?: number;     // Base backoff in ms, default 1000 (doubles each retry)
  onProgress?: (done: number, total: number) => void;
}

export interface AsyncPoolResult<T, R> {
  results: R[];
  failures: Array<{ item: T; error: Error }>;
}

export async function asyncPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
  options: AsyncPoolOptions = {},
): Promise<AsyncPoolResult<T, R>> {
  const { retries = 3, backoffMs = 1000, onProgress } = options;
  const results: R[] = new Array(items.length);
  const failures: Array<{ item: T; error: Error }> = [];
  let idx = 0;
  let done = 0;

  async function runNext(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i];

      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          results[i] = await worker(item);
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < retries) {
            const delay = backoffMs * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }

      done++;
      if (lastError) {
        failures.push({ item, error: lastError });
      }
      onProgress?.(done, items.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()),
  );

  return { results, failures };
}
