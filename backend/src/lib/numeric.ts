/** Convert Drizzle decimal strings (or any nullable numeric) to a JS number. */
export function toNum(val: string | number | null | undefined, fallback = 0): number {
  if (val == null) return fallback;
  const n = Number(val);
  return Number.isNaN(n) ? fallback : n;
}
