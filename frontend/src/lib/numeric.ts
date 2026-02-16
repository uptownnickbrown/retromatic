/** Safely convert any API value to a number, with a NaN-safe fallback. */
export function safeNum(val: unknown, fallback = 0): number {
  if (val == null) return fallback;
  const n = Number(val);
  return Number.isNaN(n) ? fallback : n;
}
