import type { Challenge, GameSession, RoundData, RevealData, ResultsData, LeaderboardEntry } from '../types';

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
  session: GameSession | null;
}> {
  return fetchAPI('/challenge/today');
}

export async function startGame(challengeId: number): Promise<{
  session: { id: string; currentRound: number };
  round: RoundData;
}> {
  return fetchAPI(`/challenge/${challengeId}/start`, { method: 'POST' });
}

export async function submitPick(
  challengeId: number,
  sessionId: string,
  roundId: number,
  playerId: number,
  year: number,
  wasTimeout: boolean = false
): Promise<{
  reveal: RevealData;
  nextRound: RoundData | null;
}> {
  return fetchAPI(`/challenge/${challengeId}/pick`, {
    method: 'POST',
    body: JSON.stringify({ sessionId, roundId, playerId, year, wasTimeout }),
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
