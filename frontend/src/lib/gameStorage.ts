import type { RoundData, RoundCommunityStats, PickSummary, PickSubmission } from '../types';

const STORAGE_KEY = 'sandlot_saved_game';

export interface SavedGame {
  challengeId: number;
  challengeDate: string;
  sessionId: string;
  rounds: RoundData[];
  communityStats: RoundCommunityStats[];
  currentRoundIndex: number;
  picks: PickSummary[];
  pickSubmissions: PickSubmission[];
}

export function saveGame(game: SavedGame): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  } catch {
    // localStorage full or unavailable — game still works, just can't resume
  }
}

export function loadSavedGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const game = JSON.parse(raw) as SavedGame;

    // Staleness check: discard if not today's challenge
    const today = new Date().toISOString().split('T')[0];
    if (game.challengeDate !== today) {
      clearSavedGame();
      return null;
    }

    return game;
  } catch {
    clearSavedGame();
    return null;
  }
}

export function clearSavedGame(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
