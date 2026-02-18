import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGame } from './useGame';
import type { Challenge, RoundData, RoundCommunityStats, FullGameData } from '../types';

// Mock dependencies
vi.mock('../lib/api', () => ({
  getTodaysChallenge: vi.fn(),
  startGame: vi.fn(),
  completeGame: vi.fn(),
}));

vi.mock('../lib/adminApi', () => ({
  startPlaytest: vi.fn(),
}));

vi.mock('../lib/gameStorage', () => ({
  loadSavedGame: vi.fn(),
  saveGame: vi.fn(),
  clearSavedGame: vi.fn(),
}));

import * as api from '../lib/api';
import * as adminApi from '../lib/adminApi';
import * as gameStorage from '../lib/gameStorage';

const mockChallenge: Challenge = {
  id: 1,
  date: '2024-07-04',
  positionOrder: ['C', '1B', '2B', 'SS', '3B', 'OF', 'UTIL', 'SP', 'RP', 'P'],
  theme: null,
  totalRounds: 10,
};

function makeRound(roundNumber: number, position: string): RoundData {
  return {
    roundId: roundNumber * 100,
    roundNumber,
    position,
    timeLimit: 30,
    players: [
      {
        slot: 1,
        name: 'Test Player 1',
        playerId: 'player1',
        portraitUrl: null,
        yearOptions: [
          { year: 2020, playerRecordId: 1001, zScorePosition: 2.0, team: 'NYA', stats: {}, categoryZscores: {}, playerType: 'batter' },
          { year: 2021, playerRecordId: 1002, zScorePosition: 1.5, team: 'NYA', stats: {}, categoryZscores: {}, playerType: 'batter' },
          { year: 2022, playerRecordId: 1003, zScorePosition: 0.5, team: 'NYA', stats: {}, categoryZscores: {}, playerType: 'batter' },
        ],
        blurbs: { '2020': 'Great season', '2021': 'Solid year', '2022': 'Decent' },
      },
      {
        slot: 2,
        name: 'Test Player 2',
        playerId: 'player2',
        portraitUrl: null,
        yearOptions: [
          { year: 2019, playerRecordId: 2001, zScorePosition: 3.0, team: 'BOS', stats: {}, categoryZscores: {}, playerType: 'batter' },
          { year: 2020, playerRecordId: 2002, zScorePosition: 1.0, team: 'BOS', stats: {}, categoryZscores: {}, playerType: 'batter' },
          { year: 2021, playerRecordId: 2003, zScorePosition: -0.5, team: 'BOS', stats: {}, categoryZscores: {}, playerType: 'batter' },
        ],
        blurbs: { '2019': 'MVP caliber', '2020': 'OK year', '2021': 'Down year' },
      },
      {
        slot: 3,
        name: 'Test Player 3',
        playerId: 'player3',
        portraitUrl: null,
        yearOptions: [
          { year: 2018, playerRecordId: 3001, zScorePosition: 5.0, team: 'LAN', stats: {}, categoryZscores: {}, playerType: 'batter' },
          { year: 2019, playerRecordId: 3002, zScorePosition: 4.0, team: 'LAN', stats: {}, categoryZscores: {}, playerType: 'batter' },
          { year: 2020, playerRecordId: 3003, zScorePosition: 2.5, team: 'LAN', stats: {}, categoryZscores: {}, playerType: 'batter' },
        ],
        blurbs: { '2018': 'Legendary', '2019': 'Excellent', '2020': 'Good' },
      },
    ],
  };
}

const mockRounds: RoundData[] = [
  makeRound(1, 'C'),
  makeRound(2, '1B'),
];

const mockCommunityStats: RoundCommunityStats[] = [
  { roundId: 100, picks: [{ playerId: 1001, year: 2020, percentage: 40 }] },
  { roundId: 200, picks: [{ playerId: 2001, year: 2019, percentage: 50 }] },
];

const mockFullGameData: FullGameData = {
  session: { id: 'session-abc', status: 'in_progress' },
  challenge: mockChallenge,
  rounds: mockRounds,
  communityStats: mockCommunityStats,
};

describe('useGame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gameStorage.loadSavedGame).mockReturnValue(null);
  });

  describe('initial state', () => {
    it('starts in loading phase with no data', () => {
      const { result } = renderHook(() => useGame());

      expect(result.current.phase).toBe('loading');
      expect(result.current.challenge).toBeNull();
      expect(result.current.sessionId).toBeNull();
      expect(result.current.currentRound).toBeNull();
      expect(result.current.picks).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.isPlaytest).toBe(false);
    });
  });

  describe('loadAndStart', () => {
    it('transitions to picking phase on successful load', async () => {
      vi.mocked(api.getTodaysChallenge).mockResolvedValue({
        challenge: mockChallenge,
        session: null,
      });
      vi.mocked(api.startGame).mockResolvedValue(mockFullGameData);

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadAndStart();
      });

      expect(result.current.phase).toBe('picking');
      expect(result.current.challenge).toEqual(mockChallenge);
      expect(result.current.sessionId).toBe('session-abc');
      expect(result.current.currentRound).toEqual(mockRounds[0]);
    });

    it('transitions to idle with error when no challenge is available', async () => {
      vi.mocked(api.getTodaysChallenge).mockResolvedValue({
        challenge: null,
        session: null,
      });

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadAndStart();
      });

      expect(result.current.phase).toBe('idle');
      expect(result.current.error).toContain('No challenge available');
    });

    it('transitions to complete when session is already completed', async () => {
      vi.mocked(api.getTodaysChallenge).mockResolvedValue({
        challenge: mockChallenge,
        session: { id: 'session-done', status: 'completed' },
      });

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadAndStart();
      });

      expect(result.current.phase).toBe('complete');
      expect(result.current.sessionId).toBe('session-done');
    });

    it('resumes from localStorage when saved game matches challenge', async () => {
      vi.mocked(api.getTodaysChallenge).mockResolvedValue({
        challenge: mockChallenge,
        session: null,
      });
      vi.mocked(gameStorage.loadSavedGame).mockReturnValue({
        challengeId: 1,
        challengeDate: '2024-07-04',
        sessionId: 'session-saved',
        rounds: mockRounds,
        communityStats: mockCommunityStats,
        currentRoundIndex: 1,
        picks: [{ roundNumber: 1, position: 'C', playerName: 'Test Player 1', year: 2020, legendScore: 4.5 }],
        pickSubmissions: [{ roundId: 100, playerRecordId: 1001, year: 2020, wasTimeout: false }],
      });

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadAndStart();
      });

      expect(result.current.phase).toBe('picking');
      expect(result.current.sessionId).toBe('session-saved');
      expect(result.current.roundNumber).toBe(2); // resumed at round 2
      expect(result.current.picks).toHaveLength(1);
      // Should not have called startGame since we resumed
      expect(api.startGame).not.toHaveBeenCalled();
    });

    it('handles API errors gracefully', async () => {
      vi.mocked(api.getTodaysChallenge).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadAndStart();
      });

      expect(result.current.phase).toBe('idle');
      expect(result.current.error).toBe('Network error');
    });

    it('saves initial state to localStorage on fresh start', async () => {
      vi.mocked(api.getTodaysChallenge).mockResolvedValue({
        challenge: mockChallenge,
        session: null,
      });
      vi.mocked(api.startGame).mockResolvedValue(mockFullGameData);

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadAndStart();
      });

      expect(gameStorage.saveGame).toHaveBeenCalledWith(
        expect.objectContaining({
          challengeId: 1,
          sessionId: 'session-abc',
          currentRoundIndex: 0,
          picks: [],
        })
      );
    });
  });

  describe('submitPick', () => {
    it('transitions from picking to revealing with correct data', async () => {
      vi.mocked(api.getTodaysChallenge).mockResolvedValue({
        challenge: mockChallenge,
        session: null,
      });
      vi.mocked(api.startGame).mockResolvedValue(mockFullGameData);

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadAndStart();
      });

      act(() => {
        result.current.submitPick(1001, 2020);
      });

      expect(result.current.phase).toBe('revealing');
      expect(result.current.reveal).not.toBeNull();
      expect(result.current.reveal?.playerName).toBe('Test Player 1');
      expect(result.current.reveal?.year).toBe(2020);
      expect(result.current.reveal?.legendScore).toBeGreaterThan(0);
      expect(result.current.reveal?.blurb).toBe('Great season');
      expect(result.current.picks).toHaveLength(1);
    });

    it('saves game state to localStorage after pick', async () => {
      vi.mocked(api.getTodaysChallenge).mockResolvedValue({
        challenge: mockChallenge,
        session: null,
      });
      vi.mocked(api.startGame).mockResolvedValue(mockFullGameData);

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadAndStart();
      });

      vi.mocked(gameStorage.saveGame).mockClear();

      act(() => {
        result.current.submitPick(1001, 2020);
      });

      expect(gameStorage.saveGame).toHaveBeenCalledWith(
        expect.objectContaining({
          currentRoundIndex: 1,
          picks: expect.arrayContaining([
            expect.objectContaining({ playerName: 'Test Player 1', year: 2020 }),
          ]),
        })
      );
    });

    it('records wasTimeout flag', async () => {
      vi.mocked(api.getTodaysChallenge).mockResolvedValue({
        challenge: mockChallenge,
        session: null,
      });
      vi.mocked(api.startGame).mockResolvedValue(mockFullGameData);

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadAndStart();
      });

      act(() => {
        result.current.submitPick(1001, 2020, true);
      });

      // Check pickSubmissions include wasTimeout
      expect(gameStorage.saveGame).toHaveBeenCalledWith(
        expect.objectContaining({
          pickSubmissions: expect.arrayContaining([
            expect.objectContaining({ wasTimeout: true }),
          ]),
        })
      );
    });
  });

  describe('advanceRound', () => {
    it('transitions from revealing to picking for next round', async () => {
      vi.mocked(api.getTodaysChallenge).mockResolvedValue({
        challenge: mockChallenge,
        session: null,
      });
      vi.mocked(api.startGame).mockResolvedValue(mockFullGameData);

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadAndStart();
      });

      // Pick in round 1
      act(() => {
        result.current.submitPick(1001, 2020);
      });
      expect(result.current.phase).toBe('revealing');

      // Advance to round 2
      act(() => {
        result.current.advanceRound();
      });
      expect(result.current.phase).toBe('picking');
      expect(result.current.reveal).toBeNull();
      expect(result.current.currentRound?.roundNumber).toBe(2);
    });

    it('transitions to submitting_final after last round', async () => {
      vi.mocked(api.getTodaysChallenge).mockResolvedValue({
        challenge: mockChallenge,
        session: null,
      });
      vi.mocked(api.startGame).mockResolvedValue(mockFullGameData);

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadAndStart();
      });

      // Pick round 1
      act(() => { result.current.submitPick(1001, 2020); });
      act(() => { result.current.advanceRound(); });

      // Pick round 2 (last round in our mock)
      act(() => { result.current.submitPick(2001, 2019); });
      act(() => { result.current.advanceRound(); });

      expect(result.current.phase).toBe('submitting_final');
    });
  });

  describe('loadPlaytest', () => {
    it('loads a playtest session', async () => {
      vi.mocked(adminApi.startPlaytest).mockResolvedValue({
        session: { id: 'playtest-1-12345', status: 'in_progress' },
        challenge: mockChallenge,
        rounds: mockRounds,
        communityStats: mockCommunityStats,
      });

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadPlaytest(1);
      });

      expect(result.current.phase).toBe('picking');
      expect(result.current.isPlaytest).toBe(true);
      expect(result.current.sessionId).toBe('playtest-1-12345');
    });

    it('does not save to localStorage in playtest mode', async () => {
      vi.mocked(adminApi.startPlaytest).mockResolvedValue({
        session: { id: 'playtest-1-12345', status: 'in_progress' },
        challenge: mockChallenge,
        rounds: mockRounds,
        communityStats: mockCommunityStats,
      });

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadPlaytest(1);
      });

      act(() => {
        result.current.submitPick(1001, 2020);
      });

      // saveGame should not be called during playtest
      expect(gameStorage.saveGame).not.toHaveBeenCalled();
    });
  });
});
