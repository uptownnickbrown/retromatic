// Re-export all types from api.ts for convenience
export type {
  PlayerSeason,
  PlayerSearchResult,
  PlayerDetails,
  DraftPick,
  Draft,
  DraftResults,
  DraftResultsResponse,
  LeaderboardEntry,
} from '../lib/api';

// Additional UI-specific types

export interface RosterSlot {
  id: string;
  label: string;
  position: string;
  playerType: 'batter' | 'pitcher';
  flexPositions?: string[]; // For UTIL and P slots
}

export const ROSTER_CONFIG: RosterSlot[] = [
  // Batters
  { id: 'C', label: 'C', position: 'C', playerType: 'batter' },
  { id: '1B', label: '1B', position: '1B', playerType: 'batter' },
  { id: '2B', label: '2B', position: '2B', playerType: 'batter' },
  { id: '3B', label: '3B', position: '3B', playerType: 'batter' },
  { id: 'SS', label: 'SS', position: 'SS', playerType: 'batter' },
  { id: 'OF1', label: 'OF', position: 'OF', playerType: 'batter', flexPositions: ['LF', 'CF', 'RF', 'OF'] },
  { id: 'OF2', label: 'OF', position: 'OF', playerType: 'batter', flexPositions: ['LF', 'CF', 'RF', 'OF'] },
  { id: 'OF3', label: 'OF', position: 'OF', playerType: 'batter', flexPositions: ['LF', 'CF', 'RF', 'OF'] },
  { id: 'UTIL', label: 'UTIL', position: 'UTIL', playerType: 'batter', flexPositions: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF'] },
  // Pitchers
  { id: 'SP1', label: 'SP', position: 'SP', playerType: 'pitcher' },
  { id: 'SP2', label: 'SP', position: 'SP', playerType: 'pitcher' },
  { id: 'SP3', label: 'SP', position: 'SP', playerType: 'pitcher' },
  { id: 'RP1', label: 'RP', position: 'RP', playerType: 'pitcher' },
  { id: 'RP2', label: 'RP', position: 'RP', playerType: 'pitcher' },
  { id: 'P1', label: 'P', position: 'P', playerType: 'pitcher', flexPositions: ['SP', 'RP', 'P'] },
  { id: 'P2', label: 'P', position: 'P', playerType: 'pitcher', flexPositions: ['SP', 'RP', 'P'] },
];

export const BATTER_SLOTS = ROSTER_CONFIG.filter(s => s.playerType === 'batter');
export const PITCHER_SLOTS = ROSTER_CONFIG.filter(s => s.playerType === 'pitcher');

// Scoring categories
export const BATTING_CATEGORIES = ['R', 'HR', 'RBI', 'SB', 'AVG'] as const;
export const PITCHING_CATEGORIES = ['W', 'SV', 'K', 'ERA', 'WHIP'] as const;
export const ALL_CATEGORIES = [...BATTING_CATEGORIES, ...PITCHING_CATEGORIES] as const;

export type BattingCategory = typeof BATTING_CATEGORIES[number];
export type PitchingCategory = typeof PITCHING_CATEGORIES[number];
export type Category = typeof ALL_CATEGORIES[number];

// Categories where lower is better
export const INVERTED_CATEGORIES: Category[] = ['ERA', 'WHIP'];

export function isInvertedCategory(cat: Category): boolean {
  return INVERTED_CATEGORIES.includes(cat);
}

export function formatCategoryValue(category: Category, value: number): string {
  switch (category) {
    case 'AVG':
      return value.toFixed(3);
    case 'ERA':
    case 'WHIP':
      return value.toFixed(2);
    default:
      return Math.round(value).toString();
  }
}

export function getCategoryLabel(category: Category): string {
  switch (category) {
    case 'R': return 'Runs';
    case 'HR': return 'Home Runs';
    case 'RBI': return 'RBIs';
    case 'SB': return 'Stolen Bases';
    case 'AVG': return 'Batting Average';
    case 'W': return 'Wins';
    case 'SV': return 'Saves';
    case 'K': return 'Strikeouts';
    case 'ERA': return 'ERA';
    case 'WHIP': return 'WHIP';
    default: return category;
  }
}
