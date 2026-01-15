import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num);
}

export function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function getStarRating(zScore: number): number {
  if (zScore > 2.0) return 5;
  if (zScore > 1.0) return 4;
  if (zScore > 0.0) return 3;
  if (zScore > -1.0) return 2;
  return 1;
}

export function getStarLabel(stars: number): string {
  switch (stars) {
    case 5: return 'Elite';
    case 4: return 'All-Star';
    case 3: return 'Solid';
    case 2: return 'Average';
    default: return 'Below Average';
  }
}
