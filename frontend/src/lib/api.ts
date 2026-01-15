const API_BASE = '/api';

// Get or create guest token
export function getGuestToken(): string {
  let token = localStorage.getItem('retromatic_guest_token');
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem('retromatic_guest_token', token);
  }
  return token;
}

async function fetchAPI<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Guest-Token': getGuestToken(),
    ...((options.headers as Record<string, string>) || {}),
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP error ${response.status}`);
  }

  return response.json();
}

// Player types
export interface PlayerSeason {
  id: number;
  year: number;
  team: string;
  positions: string;
}

export interface PlayerSearchResult {
  id: number;
  name: string;
  yearRange: string;
  teams: string[];
  positions: string[];
  playerType: 'batter' | 'pitcher';
  seasons: PlayerSeason[];
}

export interface PlayerDetails {
  id: number;
  playerId: string;
  nameFirst: string;
  nameLast: string;
  year: number;
  team: string;
  playerType: 'batter' | 'pitcher';
  primaryPosition: string;
  positionsEligible: string;
  stats: Record<string, number>;
  zScoreOverall: string;
  zScorePosition: string;
  starRating: number;
}

// Draft types
export interface DraftPick {
  id: number;
  playerId: number;
  rosterSlot: string;
  pickOrder: number;
  playerName: string;
  year: number;
  team: string;
  position: string;
}

export interface Draft {
  id: number;
  guestToken: string;
  status: 'in_progress' | 'completed';
  totalScore: string | null;
  percentile: number | null;
  picks: DraftPick[];
  filledSlots: string[];
  availableSlots: string[];
  pickCount: number;
  isComplete: boolean;
}

export interface DraftResults {
  totalScore: number;
  percentile: number;
  categoryScores: Record<string, number>;
  categoryPercentiles: Record<string, number>;
  rotoPlacement: number;
  rotoScoreboard: Array<{
    rank: number;
    teamName: string;
    points: number;
    isUser: boolean;
  }>;
  winLossRecord: string;
  outlierFacts: string[];
  aiCommentary: string;
}

export interface DraftResultsResponse {
  draft: Draft & {
    categoryScores: Record<string, number>;
    aiCommentary: string;
    rotoPlacement: number;
    winLossRecord: string;
    outlierFacts: string[];
  };
  roster: Array<{
    rosterSlot: string;
    player: PlayerDetails;
  }>;
}

// Leaderboard types
export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  score: number;
  percentile: number | null;
  rotoPlacement: number | null;
  completedAt: string;
  draftId: number;
}

// API functions

// Players
export async function searchPlayers(
  query: string,
  position?: string,
  year?: number
): Promise<{ players: PlayerSearchResult[] }> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (position) params.set('position', position);
  if (year) params.set('year', year.toString());

  return fetchAPI(`/players/search?${params.toString()}`);
}

export async function getPlayer(id: number): Promise<PlayerDetails> {
  return fetchAPI(`/players/${id}`);
}

// Drafts
export async function createDraft(): Promise<{
  draftId: number;
  guestToken: string;
  status: string;
  availableSlots: string[];
}> {
  return fetchAPI('/drafts', { method: 'POST' });
}

export async function getDraft(id: number): Promise<Draft> {
  return fetchAPI(`/drafts/${id}`);
}

export async function makePick(
  draftId: number,
  playerId: number,
  rosterSlot: string
): Promise<{
  success: boolean;
  pickOrder: number;
  rosterSlot: string;
  playerName: string;
}> {
  return fetchAPI(`/drafts/${draftId}/picks`, {
    method: 'POST',
    body: JSON.stringify({ playerId, rosterSlot }),
  });
}

export async function completeDraft(draftId: number): Promise<{
  success: boolean;
  results: DraftResults;
}> {
  return fetchAPI(`/drafts/${draftId}/complete`, { method: 'POST' });
}

export async function getDraftResults(draftId: number): Promise<DraftResultsResponse> {
  return fetchAPI(`/drafts/${draftId}/results`);
}

// Leaderboard
export async function getLeaderboard(
  limit?: number,
  period?: 'all' | 'week' | 'month'
): Promise<{
  leaderboard: LeaderboardEntry[];
  totalTeams: number;
  period: string;
}> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', limit.toString());
  if (period) params.set('period', period);

  return fetchAPI(`/leaderboard?${params.toString()}`);
}

export async function getUserDrafts(): Promise<{
  drafts: Array<{
    id: number;
    status: string;
    totalScore: string | null;
    percentile: number | null;
    rotoPlacement: number | null;
    createdAt: string;
    completedAt: string | null;
  }>;
}> {
  const token = getGuestToken();
  return fetchAPI(`/leaderboard/user/${token}/drafts`);
}

export async function getUserRank(): Promise<{
  rank: number | null;
  totalTeams: number;
  bestScore: number;
}> {
  const token = getGuestToken();
  return fetchAPI(`/leaderboard/user/${token}/rank`);
}
