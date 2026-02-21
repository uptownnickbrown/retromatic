import type { FullGameData } from '../types';

const API_BASE = '/api';

function getAdminSecret(): string | null {
  return sessionStorage.getItem('sandlot_admin_secret');
}

export function setAdminSecret(secret: string): void {
  sessionStorage.setItem('sandlot_admin_secret', secret);
}

export function clearAdminSecret(): void {
  sessionStorage.removeItem('sandlot_admin_secret');
}

export function isAdminAuthenticated(): boolean {
  return !!getAdminSecret();
}

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const secret = getAdminSecret();
  if (!secret) throw new Error('Not authenticated');

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': secret,
      ...options.headers,
    },
  });

  if (res.status === 401 || res.status === 403) {
    clearAdminSecret();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// --- Types ---

export interface ChallengeHealth {
  rounds: number;
  roundsReady: boolean;
  playerSlots: number;
  blurbsMissing: number;
  blurbsReady: boolean;
  portraitsMissing: number;
  portraitsReady: boolean;
}

export interface PipelineChallenge {
  id: number;
  challengeDate: string;
  positionOrder: string[];
  status: string;
  theme: string | null;
  queuePosition: number | null;
  createdAt: string;
  publishedAt: string | null;
  health: ChallengeHealth;
}

export interface HistoryChallenge {
  id: number;
  challengeDate: string;
  theme: string | null;
  status: string;
  createdAt: string;
  playerCount: number;
  avgScore: number | null;
  bestScore: number | null;
}

export interface DetailedHealth {
  challengeId: number;
  status: string;
  rounds: number;
  roundsExpected: number;
  roundsReady: boolean;
  playerSlots: number;
  playerSlotsExpected: number;
  blurbs: { present: number; missing: number; total: number };
  blurbsReady: boolean;
  portraits: { present: number; missing: number; total: number };
  portraitsReady: boolean;
  legendScoreRange: { min: number; max: number } | null;
}

export interface YearScore {
  year: number;
  zScorePosition: number;
  legendScore: number;
}

export interface AdminRoundOption {
  id: number;
  roundId: number;
  playerSlot: number;
  playerId: string;
  playerName: string;
  yearOptions: number[];
  portraitUrl: string | null;
  blurbs: Record<string, string> | null;
  yearScores: YearScore[];
}

export interface AdminRound {
  id: number;
  challengeId: number;
  roundNumber: number;
  position: string;
  options: AdminRoundOption[];
}

export interface AdminChallengeDetail {
  challenge: {
    id: number;
    challengeDate: string;
    positionOrder: string[];
    status: string;
    theme: string | null;
  };
  rounds: AdminRound[];
}

// --- API Functions ---

export async function getPipeline(): Promise<{ challenges: PipelineChallenge[] }> {
  return adminFetch('/admin/challenges/pipeline');
}

export async function getHistory(): Promise<{ challenges: HistoryChallenge[] }> {
  return adminFetch('/admin/challenges/history');
}

export async function getChallengeDetail(id: number): Promise<AdminChallengeDetail> {
  return adminFetch(`/admin/challenges/${id}`);
}

export async function getChallengeHealth(id: number): Promise<DetailedHealth> {
  return adminFetch(`/admin/challenges/${id}/health`);
}

export async function generateChallenge(count = 1, theme?: string): Promise<{ challengeIds: number[]; count: number }> {
  return adminFetch('/admin/challenges/generate', {
    method: 'POST',
    body: JSON.stringify({ count, theme }),
  });
}

export async function generateThemedBatch(count = 25): Promise<{ challengeIds: number[]; count: number; themes: string[] }> {
  return adminFetch('/admin/challenges/generate-themed', {
    method: 'POST',
    body: JSON.stringify({ count }),
  });
}

export async function generateBlurbs(id: number): Promise<{ generated: number; failed: number }> {
  return adminFetch(`/admin/challenges/${id}/blurbs`, { method: 'POST' });
}

export async function preseedStats(id: number): Promise<{ roundsSeeded: number; totalPicks: number; syntheticSessions: number }> {
  return adminFetch(`/admin/challenges/${id}/preseed`, { method: 'POST' });
}

export async function generatePortraits(id: number): Promise<{ generated: number; skipped: number; failed: number }> {
  return adminFetch(`/admin/challenges/${id}/portraits`, { method: 'POST' });
}

export async function updateChallenge(id: number, updates: {
  status?: string;
  theme?: string;
  challengeDate?: string;
}): Promise<{ challenge: PipelineChallenge }> {
  return adminFetch(`/admin/challenges/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteChallenge(id: number): Promise<{ deleted: boolean }> {
  return adminFetch(`/admin/challenges/${id}`, { method: 'DELETE' });
}

export async function queueChallenges(challengeIds: number[]): Promise<{ queued: number }> {
  return adminFetch('/admin/challenges/queue', {
    method: 'POST',
    body: JSON.stringify({ challengeIds }),
  });
}

export async function dequeueChallenges(challengeId: number): Promise<{ dequeued: boolean }> {
  return adminFetch('/admin/challenges/dequeue', {
    method: 'POST',
    body: JSON.stringify({ challengeId }),
  });
}

export async function reorderQueue(challengeIds: number[]): Promise<{ reordered: number }> {
  return adminFetch('/admin/challenges/reorder', {
    method: 'POST',
    body: JSON.stringify({ challengeIds }),
  });
}

export async function promoteNext(): Promise<{ activated: number | null; completed: number }> {
  return adminFetch('/admin/promote-next', { method: 'POST' });
}

export async function startPlaytest(challengeId: number): Promise<FullGameData> {
  return adminFetch(`/admin/challenges/${challengeId}/playtest`, { method: 'POST' });
}

// --- Single-player operations ---

export async function regenerateOptionPortrait(optionId: number): Promise<{ generated: boolean; portraitUrl: string }> {
  return adminFetch(`/admin/options/${optionId}/portrait`, { method: 'POST' });
}

export async function regenerateOptionBlurbs(optionId: number): Promise<{ generated: number; failed: number; blurbs: Record<string, string> }> {
  return adminFetch(`/admin/options/${optionId}/blurbs`, { method: 'POST' });
}

export async function updateOptionBlurb(optionId: number, year: number, blurb: string): Promise<{ blurbs: Record<string, string> }> {
  return adminFetch(`/admin/options/${optionId}/blurb`, {
    method: 'PATCH',
    body: JSON.stringify({ year, blurb }),
  });
}
