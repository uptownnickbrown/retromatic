export const POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'OF', 'UTIL', 'SP', 'RP', 'P'] as const;
export type Position = typeof POSITIONS[number];

export interface Challenge {
  id: number;
  date: string;
  positionOrder: string[];
  theme: string | null;
  totalRounds: number;
}

export interface PickSummary {
  roundNumber: number;
  position: string;
  playerName: string;
  year: number;
  legendScore: number;
}

// --- Enriched types for front-loaded game data ---

export interface YearOption {
  year: number;
  playerRecordId: number;
  zScorePosition: number;
  team: string;
  stats: Record<string, number>;
  categoryZscores: Record<string, number>;
  playerType: 'batter' | 'pitcher';
}

export interface PlayerOption {
  slot: number;
  name: string;
  playerId: string;
  portraitUrl: string | null;
  yearOptions: YearOption[];
  blurbs: Record<string, string>;
}

export interface RoundData {
  roundId: number;
  roundNumber: number;
  position: string;
  players: PlayerOption[];
  timeLimit: number;
}

export interface PickPercentage {
  playerId: number;
  year: number;
  percentage: number;
}

export interface RoundCommunityStats {
  roundId: number;
  picks: PickPercentage[];
}

export interface FullGameData {
  session: { id: string; status: string };
  challenge: Challenge;
  rounds: RoundData[];
  communityStats: RoundCommunityStats[];
}

export interface PickSubmission {
  roundId: number;
  playerRecordId: number;
  year: number;
  wasTimeout: boolean;
}

export interface CompleteResponse {
  totalLegendScore: number;
  percentile: number;
  totalParticipants: number;
  communityStats: RoundCommunityStats[];
  perfectLineup: PerfectLineup;
}

export interface RevealRoundPlayer {
  name: string;
  portraitUrl: string | null;
  yearOptions: { year: number; team: string; playerRecordId: number }[];
}

export interface RevealData {
  legendScore: number;
  blurb: string;
  stats: Record<string, number>;
  categoryZscores: Record<string, number>;
  playerType: 'batter' | 'pitcher';
  playerName: string;
  portraitUrl: string | null;
  year: number;
  team: string;
  pickPercentages?: PickPercentage[];
  roundPlayers?: RevealRoundPlayer[];
}

export interface ResultsPick {
  roundNumber: number;
  position: string;
  playerName: string;
  year: number;
  team: string;
  legendScore: number;
  stats: Record<string, number>;
  wasTimeout: boolean;
  portraitUrl?: string | null;
  blurb?: string;
  categoryZscores?: Record<string, number>;
  playerType?: 'batter' | 'pitcher';
}

export interface PerfectLineupPick {
  roundNumber: number;
  position: string;
  playerName: string;
  year: number;
  legendScore: number;
  stats?: Record<string, number>;
  categoryZscores?: Record<string, number>;
  playerType?: 'batter' | 'pitcher';
  team?: string;
  blurb?: string;
}

export interface PerfectLineup {
  picks: PerfectLineupPick[];
  totalScore: number;
}

export interface ResultsData {
  session: { totalLegendScore: number; percentile: number; completedAt: string };
  picks: ResultsPick[];
  perfectLineup: PerfectLineup;
  totalParticipants: number;
  communityStats?: RoundCommunityStats[];
}

export interface HomeData {
  today: { id: number; date: string; theme: string | null; totalRounds: number } | null;
  session: { id: string; status: string; totalLegendScore?: number; percentile?: number } | null;
  yesterday: { id: number; date: string; theme: string | null } | null;
  tomorrow: { theme: string | null } | null;
}

export interface RecapData {
  challenge: { id: number; date: string; theme: string | null };
  communityLineup: { picks: ResultsPick[]; totalScore: number };
  perfectLineup: PerfectLineup;
  totalParticipants: number;
}

// Sandlot Score helpers — 3-tier system
export function getSandlotScoreColor(score: number): string {
  if (score >= 9.5) return 'text-gold';
  if (score >= 6.0) return 'text-navy';
  return 'text-muted';
}

export function getSandlotScoreBg(score: number): string {
  if (score >= 9.5) return 'bg-gold/20 border-gold/50';
  if (score >= 6.0) return 'bg-navy/10 border-navy/30';
  return 'bg-muted/10 border-muted/30';
}

export function getSandlotScoreLabel(score: number): string {
  if (score >= 9.5) return 'SANDLOT LEGEND';
  if (score >= 6.0) return 'GREAT';
  return 'AVERAGE';
}

export function getSandlotScoreTier(score: number): string {
  if (score >= 9.5) return 'tier-legendary';
  if (score >= 6.0) return 'tier-great';
  return 'tier-average';
}
