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

export interface RevealData {
  legendScore: number;
  blurb: string;
  stats: Record<string, number>;
  playerName: string;
  year: number;
  team: string;
  pickPercentages?: PickPercentage[];
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
}

export interface PerfectLineup {
  picks: Array<{ roundNumber: number; position: string; playerName: string; year: number; legendScore: number }>;
  totalScore: number;
}

export interface ResultsData {
  session: { totalLegendScore: number; percentile: number; completedAt: string };
  picks: ResultsPick[];
  perfectLineup: PerfectLineup;
  totalParticipants: number;
  communityStats?: RoundCommunityStats[];
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  score: number;
  percentile: number;
  completedAt: string;
}

// Legend Score helpers
export function getLegendScoreColor(score: number): string {
  if (score >= 9.0) return 'text-yellow-400';
  if (score >= 7.0) return 'text-emerald-400';
  if (score >= 5.0) return 'text-blue-400';
  if (score >= 3.0) return 'text-orange-400';
  return 'text-red-400';
}

export function getLegendScoreBg(score: number): string {
  if (score >= 9.0) return 'bg-yellow-400/20 border-yellow-400/50';
  if (score >= 7.0) return 'bg-emerald-400/20 border-emerald-400/50';
  if (score >= 5.0) return 'bg-blue-400/20 border-blue-400/50';
  if (score >= 3.0) return 'bg-orange-400/20 border-orange-400/50';
  return 'bg-red-400/20 border-red-400/50';
}

export function getLegendScoreLabel(score: number): string {
  if (score >= 9.5) return 'LEGENDARY';
  if (score >= 8.5) return 'ELITE';
  if (score >= 7.0) return 'ALL-STAR';
  if (score >= 5.0) return 'SOLID';
  if (score >= 3.0) return 'AVERAGE';
  return 'BENCH';
}

export function getLegendScoreTier(score: number): string {
  if (score >= 9.5) return 'legend-legendary';
  if (score >= 8.5) return 'legend-elite';
  if (score >= 7.0) return 'legend-allstar';
  if (score >= 5.0) return 'legend-solid';
  if (score >= 3.0) return 'legend-average';
  return 'legend-bench';
}

export function getPositionEmoji(position: string): string {
  const map: Record<string, string> = {
    C: '\u{1F3D1}', '1B': '\u{1F94E}', '2B': '\u{1F94E}', SS: '\u{1F94E}',
    '3B': '\u{1F94E}', OF: '\u{1F3DF}', UTIL: '\u{26A1}',
    SP: '\u{1F4A8}', RP: '\u{1F525}', P: '\u{1F3AF}',
  };
  return map[position] || '\u{26BE}';
}
