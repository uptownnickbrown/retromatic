import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { saveGame, loadSavedGame, clearSavedGame, type SavedGame } from './gameStorage';

function makeSavedGame(overrides: Partial<SavedGame> = {}): SavedGame {
  return {
    challengeId: 1,
    challengeDate: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    sessionId: 'session-123',
    rounds: [],
    communityStats: [],
    currentRoundIndex: 0,
    picks: [],
    pickSubmissions: [],
    ...overrides,
  };
}

describe('gameStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('saveGame', () => {
    it('saves game state to localStorage', () => {
      const game = makeSavedGame();
      saveGame(game);

      const stored = localStorage.getItem('sandlot_saved_game');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(game);
    });

    it('does not throw when localStorage is unavailable', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      expect(() => saveGame(makeSavedGame())).not.toThrow();
    });
  });

  describe('loadSavedGame', () => {
    it('returns null when no saved game exists', () => {
      expect(loadSavedGame()).toBeNull();
    });

    it('returns saved game when date matches today', () => {
      const game = makeSavedGame();
      localStorage.setItem('sandlot_saved_game', JSON.stringify(game));

      const loaded = loadSavedGame();
      expect(loaded).toEqual(game);
    });

    it('returns null and clears stale game from a different day', () => {
      const game = makeSavedGame({ challengeDate: '2020-01-01' });
      localStorage.setItem('sandlot_saved_game', JSON.stringify(game));

      expect(loadSavedGame()).toBeNull();
      expect(localStorage.getItem('sandlot_saved_game')).toBeNull();
    });

    it('returns null and clears on corrupted JSON', () => {
      localStorage.setItem('sandlot_saved_game', '{not valid json');

      expect(loadSavedGame()).toBeNull();
      expect(localStorage.getItem('sandlot_saved_game')).toBeNull();
    });

    it('preserves picks and round index on load', () => {
      const game = makeSavedGame({
        currentRoundIndex: 5,
        picks: [
          { roundNumber: 1, position: 'C', playerName: 'Babe Ruth', year: 1927, legendScore: 9.8 },
        ],
      });
      localStorage.setItem('sandlot_saved_game', JSON.stringify(game));

      const loaded = loadSavedGame();
      expect(loaded?.currentRoundIndex).toBe(5);
      expect(loaded?.picks).toHaveLength(1);
      expect(loaded?.picks[0].playerName).toBe('Babe Ruth');
    });
  });

  describe('clearSavedGame', () => {
    it('removes saved game from localStorage', () => {
      localStorage.setItem('sandlot_saved_game', '{}');
      clearSavedGame();
      expect(localStorage.getItem('sandlot_saved_game')).toBeNull();
    });

    it('does not throw when localStorage is unavailable', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });

      expect(() => clearSavedGame()).not.toThrow();
    });
  });
});
