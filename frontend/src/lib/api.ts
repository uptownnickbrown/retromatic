import type { Challenge, FullGameData, CompleteResponse, PickSubmission, ResultsData, HomeData, RecapData } from '../types';

const API_BASE = '/api';

// Guest token management
function generateUUID(): string {
  // crypto.randomUUID() requires a secure context (HTTPS or localhost).
  // Fall back to getRandomValues for plain HTTP (e.g., mobile testing over LAN).
  if (typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch { /* not secure context */ }
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function getGuestToken(): string {
  let token = localStorage.getItem('sandlot_guest_token');
  if (!token) {
    token = generateUUID();
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

// Home page data (bundled)
export async function getHomeData(): Promise<HomeData> {
  return fetchAPI('/challenge/home');
}

// Community recap
export async function getRecapData(challengeId: number): Promise<RecapData> {
  return fetchAPI(`/challenge/${challengeId}/recap`);
}

// Replay (public — replay a completed challenge)
export async function startReplay(challengeId: number): Promise<FullGameData> {
  return fetchAPI(`/challenge/${challengeId}/replay`, { method: 'POST' });
}

export async function getReplayPercentile(
  challengeId: number,
  totalLegendScore: number,
): Promise<{ percentile: number; totalParticipants: number }> {
  return fetchAPI(`/challenge/${challengeId}/replay-percentile`, {
    method: 'POST',
    body: JSON.stringify({ totalLegendScore }),
  });
}

// Streak API
export async function getStreak(): Promise<{
  current: number;
  longest: number;
  gamesPlayed: number;
  averageScore: number;
  averagePercentile: number;
}> {
  return fetchAPI('/challenge/streak');
}
