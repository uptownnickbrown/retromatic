// Player position types
export type BattingPosition = 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'UTIL';
export type PitchingPosition = 'SP' | 'RP' | 'P';
export type PlayerPosition = BattingPosition | PitchingPosition;

// Define stats types
export type BattingStats = {
  R: number;
  HR: number;
  RBI: number;
  SB: number;
  AVG: number;
  // Additional stats for display or calculations
  H?: number;
  AB?: number;
  BB?: number;
  OBP?: number;
  SLG?: number;
};

export type PitchingStats = {
  W: number;
  SV: number;
  K: number;
  ERA: number;
  WHIP: number;
  // Additional stats for display or calculations
  IP?: number;
  G?: number;
  GS?: number;
  L?: number;
  BB?: number;
  H?: number;
};

export type PlayerStats = BattingStats | PitchingStats;

// Define player types
export type Player = {
  id: string;
  playerID: string;
  nameFirst: string;
  nameLast: string;
  position: PlayerPosition;
  year: number;
  team?: string;
  stats: PlayerStats;
  zScore: number;
  posZScore: number;
};

// Draft related types
export type DraftStatus = 'created' | 'in_progress' | 'completed';

export type Draft = {
  id: number;
  status: DraftStatus;
  picks: Pick[];
  createdAt: Date;
  completedAt?: Date;
  score?: number;
  percentile?: number;
  userId?: string;
  guestId?: string;
};

export type Pick = {
  id: number;
  draftId: number;
  player: Player;
  pickNumber: number;
  round: number;
  timestamp: Date;
};

// Roster related types
export type Roster = {
  [key in PlayerPosition]?: Player[];
};

export type RosterRequirements = {
  [key in PlayerPosition]: number;
};

// Results and scoring
export type TeamScore = {
  totalScore: number;
  percentile: number;
  categoryScores: {
    [key: string]: number;
  };
};

// Auth and user types
export type User = {
  id: string;
  email?: string;
  isGuest: boolean;
  guestId?: string;
};

// App-wide state
export type AppState = {
  currentDraft?: Draft;
  user?: User;
  isLoading: boolean;
  error?: string;
};