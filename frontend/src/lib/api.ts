import type { Challenge, FullGameData, CompleteResponse, PickSubmission, ResultsData, LeaderboardEntry } from '../types';

const API_BASE = '/api';

// Guest token management
function getGuestToken(): string {
  let token = localStorage.getItem('sandlot_guest_token');
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem('sandlot_guest_token', token);
  }
  return token;
}

async function fetchAPI<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-guest-token': getGuestToken(),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Challenge API
export async function getTodaysChallenge(): Promise<{
  challenge: Challenge | null;
  session: { id: string; status: string; totalLegendScore?: number; percentile?: number } | null;
}> {
  return fetchAPI('/challenge/today');
}

export async function startGame(challengeId: number): Promise<FullGameData> {
  return fetchAPI(`/challenge/${challengeId}/start`, { method: 'POST' });
}

export async function completeGame(
  challengeId: number,
  sessionId: string,
  picks: PickSubmission[],
): Promise<CompleteResponse> {
  return fetchAPI(`/challenge/${challengeId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ sessionId, picks }),
  });
}

export async function getChallengeResults(challengeId: number): Promise<ResultsData> {
  return fetchAPI(`/challenge/${challengeId}/results`);
}

// Leaderboard API
export async function getLeaderboard(period: string = 'today'): Promise<{
  leaderboard: LeaderboardEntry[];
  period: string;
}> {
  return fetchAPI(`/leaderboard?period=${period}`);
}

export async function getStreak(): Promise<{ current: number; longest: number }> {
  return fetchAPI('/leaderboard/streak');
}
