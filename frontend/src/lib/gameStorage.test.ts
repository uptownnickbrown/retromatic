import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { saveGame, loadSavedGame, clearSavedGame, type SavedGame } from './gameStorage';

// Pin the clock so the staleness check is deterministic
const FIXED_DATE = new Date('2024-07-04T14:00:00-04:00'); // 2pm ET on July 4
const TODAY_ET = '2024-07-04';

function makeSavedGame(overrides: Partial<SavedGame> = {}): SavedGame {
  return {
    challengeId: 1,
    challengeDate: TODAY_ET,
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
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
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

    it('silently fails when localStorage throws (e.g. QuotaExceeded)', () => {
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

    it('returns saved game when challengeDate matches today (ET)', () => {
      const game = makeSavedGame({ challengeDate: TODAY_ET });
      localStorage.setItem('sandlot_saved_game', JSON.stringify(game));

      const loaded = loadSavedGame();
      expect(loaded).toEqual(game);
    });

    it('returns null and clears storage when challengeDate is yesterday', () => {
      const game = makeSavedGame({ challengeDate: '2024-07-03' });
      localStorage.setItem('sandlot_saved_game', JSON.stringify(game));

      expect(loadSavedGame()).toBeNull();
      expect(localStorage.getItem('sandlot_saved_game')).toBeNull();
    });

    it('returns null and clears storage on corrupted JSON', () => {
      localStorage.setItem('sandlot_saved_game', '{not valid json');

      expect(loadSavedGame()).toBeNull();
      expect(localStorage.getItem('sandlot_saved_game')).toBeNull();
    });

    it('handles the ET midnight boundary correctly', () => {
      // At 11:59 PM ET on July 3 (3:59 AM UTC July 4), today is still July 3
      vi.setSystemTime(new Date('2024-07-04T03:59:00Z'));
      const game = makeSavedGame({ challengeDate: '2024-07-03' });
      localStorage.setItem('sandlot_saved_game', JSON.stringify(game));

      expect(loadSavedGame()).toEqual(game); // still July 3 in ET

      // At 12:01 AM ET on July 4 (4:01 AM UTC July 4), today flips to July 4
      vi.setSystemTime(new Date('2024-07-04T04:01:00Z'));
      expect(loadSavedGame()).toBeNull(); // stale — July 3 != July 4
    });
  });

  describe('clearSavedGame', () => {
    it('removes saved game from localStorage', () => {
      localStorage.setItem('sandlot_saved_game', '{}');
      clearSavedGame();
      expect(localStorage.getItem('sandlot_saved_game')).toBeNull();
    });

    it('silently fails when localStorage throws', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });

      expect(() => clearSavedGame()).not.toThrow();
    });
  });
});
