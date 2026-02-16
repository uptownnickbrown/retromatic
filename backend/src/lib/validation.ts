/** Parse a string to a positive integer ID, returning null on failure. */
export function parseId(val: string): number | null {
  const n = parseInt(val, 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}
