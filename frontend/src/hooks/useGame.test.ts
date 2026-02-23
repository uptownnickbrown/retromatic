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
          { year: 2020, playerRecordId: 1001, zScorePosition: 2.0, team: 'NYA', stats: { HR: 30 }, categoryZscores: { HR: 1.5 }, playerType: 'batter' },
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
  {
    roundId: 100,
    totalPicks: 20,
    picks: [
      { playerId: 1001, year: 2020, count: 8, percentage: 40 },
      { playerId: 2001, year: 2019, count: 7, percentage: 35 },
      { playerId: 3001, year: 2018, count: 5, percentage: 25 },
    ],
  },
  {
    roundId: 200,
    totalPicks: 20,
    picks: [
      { playerId: 2001, year: 2019, count: 10, percentage: 50 },
      { playerId: 1001, year: 2020, count: 10, percentage: 50 },
    ],
  },
];

const mockFullGameData: FullGameData = {
  session: { id: 'session-abc', status: 'in_progress' },
  challenge: mockChallenge,
  rounds: mockRounds,
  communityStats: mockCommunityStats,
};

// Helper: load a game to the picking state
async function loadToPickingPhase() {
  vi.mocked(api.getTodaysChallenge).mockResolvedValue({
    challenge: mockChallenge,
    session: null,
  });
  vi.mocked(api.startGame).mockResolvedValue(mockFullGameData);

  const hook = renderHook(() => useGame());

  await act(async () => {
    await hook.result.current.loadAndStart();
  });

  return hook;
}

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
    it('transitions to picking with round data on successful load', async () => {
      const { result } = await loadToPickingPhase();

      expect(result.current.phase).toBe('picking');
      expect(result.current.challenge).toEqual(mockChallenge);
      expect(result.current.sessionId).toBe('session-abc');
      expect(result.current.currentRound).toEqual(mockRounds[0]);
      expect(result.current.totalRounds).toBe(2);
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
        picks: [{ roundNumber: 1, position: 'C', playerName: 'Test Player 1', year: 2020, legendScore: 4.0 }],
        pickSubmissions: [{ roundId: 100, playerRecordId: 1001, year: 2020, wasTimeout: false }],
      });

      const { result } = renderHook(() => useGame());

      await act(async () => {
        await result.current.loadAndStart();
      });

      expect(result.current.phase).toBe('picking');
      expect(result.current.sessionId).toBe('session-saved');
      expect(result.current.currentRound?.roundNumber).toBe(2);
      expect(result.current.picks).toHaveLength(1);
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
      await loadToPickingPhase();

      expect(gameStorage.saveGame).toHaveBeenCalledWith(
        expect.objectContaining({
          challengeId: 1,
          sessionId: 'session-abc',
          currentRoundIndex: 0,
          picks: [],
          pickSubmissions: [],
        })
      );
    });
  });

  describe('submitPick', () => {
    it('computes correct Sandlot Score and builds reveal data', async () => {
      const { result } = await loadToPickingPhase();

      act(() => {
        // z-score 2.0 → Sandlot Score 4.0 via calculateSandlotScore formula
        result.current.submitPick(1001, 2020);
      });

      expect(result.current.phase).toBe('revealing');
      expect(result.current.reveal).toEqual(expect.objectContaining({
        playerName: 'Test Player 1',
        year: 2020,
        legendScore: 4.0,
        blurb: 'Great season',
        team: 'NYA',
        stats: { HR: 30 },
        playerType: 'batter',
      }));
      expect(result.current.picks).toHaveLength(1);
      expect(result.current.picks[0].legendScore).toBe(4.0);
    });

    it('is a no-op for an invalid playerRecordId/year combo', async () => {
      const { result } = await loadToPickingPhase();

      act(() => {
        result.current.submitPick(9999, 1900); // doesn't exist in mock data
      });

      // Should stay in picking — no transition, no pick recorded
      expect(result.current.phase).toBe('picking');
      expect(result.current.picks).toHaveLength(0);
      expect(result.current.reveal).toBeNull();
    });

    it('saves updated game state to localStorage after pick', async () => {
      const { result } = await loadToPickingPhase();
      vi.mocked(gameStorage.saveGame).mockClear();

      act(() => {
        result.current.submitPick(1001, 2020);
      });

      expect(gameStorage.saveGame).toHaveBeenCalledWith(
        expect.objectContaining({
          currentRoundIndex: 1,
          picks: [expect.objectContaining({ playerName: 'Test Player 1', year: 2020, legendScore: 4.0 })],
          pickSubmissions: [expect.objectContaining({ roundId: 100, playerRecordId: 1001, year: 2020, wasTimeout: false })],
        })
      );
    });

    it('records wasTimeout flag in submission', async () => {
      const { result } = await loadToPickingPhase();
      vi.mocked(gameStorage.saveGame).mockClear();

      act(() => {
        result.current.submitPick(1001, 2020, true);
      });

      expect(gameStorage.saveGame).toHaveBeenCalledWith(
        expect.objectContaining({
          pickSubmissions: [expect.objectContaining({ wasTimeout: true })],
        })
      );
    });

    it('adjusts community percentages to include user pick', async () => {
      const { result } = await loadToPickingPhase();

      // Pick player 1001/2020 which has count=8 out of totalPicks=20
      act(() => {
        result.current.submitPick(1001, 2020);
      });

      // After adding user's pick: 9/21 ≈ 43%, 7/21 ≈ 33%, 5/21 ≈ 24%
      const percentages = result.current.reveal?.pickPercentages;
      expect(percentages).toBeDefined();
      const picked = percentages?.find(p => p.playerId === 1001 && p.year === 2020);
      expect(picked?.percentage).toBe(43); // Math.round(9/21 * 100)
    });

    it('shows non-zero percentage when picking an option nobody else chose', async () => {
      const { result } = await loadToPickingPhase();

      // Pick player 1002/2021 which has no prior picks in mockCommunityStats
      act(() => {
        result.current.submitPick(1002, 2021);
      });

      const percentages = result.current.reveal?.pickPercentages;
      expect(percentages).toBeDefined();
      const picked = percentages?.find(p => p.playerId === 1002 && p.year === 2021);
      expect(picked?.percentage).toBe(5); // Math.round(1/21 * 100)
    });

    it('passes percentages through unchanged for old localStorage without totalPicks', async () => {
      // Override communityStats to omit totalPicks (old format)
      const oldFormatStats: RoundCommunityStats[] = [
        { roundId: 100, picks: [{ playerId: 1001, year: 2020, percentage: 40 }] },
        { roundId: 200, picks: [{ playerId: 2001, year: 2019, percentage: 50 }] },
      ];
      vi.mocked(api.getTodaysChallenge).mockResolvedValue({
        challenge: mockChallenge,
        session: null,
      });
      vi.mocked(api.startGame).mockResolvedValue({
        ...mockFullGameData,
        communityStats: oldFormatStats,
      });

      const hook = renderHook(() => useGame());
      await act(async () => {
        await hook.result.current.loadAndStart();
      });

      act(() => {
        hook.result.current.submitPick(1001, 2020);
      });

      // Should pass through the original percentages unchanged
      const percentages = hook.result.current.reveal?.pickPercentages;
      expect(percentages).toEqual([{ playerId: 1001, year: 2020, percentage: 40 }]);
    });
  });

  describe('advanceRound', () => {
    it('transitions from revealing to picking for next round', async () => {
      const { result } = await loadToPickingPhase();

      act(() => { result.current.submitPick(1001, 2020); });
      expect(result.current.phase).toBe('revealing');

      act(() => { result.current.advanceRound(); });
      expect(result.current.phase).toBe('picking');
      expect(result.current.reveal).toBeNull();
      expect(result.current.currentRound?.roundNumber).toBe(2);
    });

    it('transitions to submitting_final after last round', async () => {
      const { result } = await loadToPickingPhase();

      // Round 1
      act(() => { result.current.submitPick(1001, 2020); });
      act(() => { result.current.advanceRound(); });

      // Round 2 (last)
      act(() => { result.current.submitPick(2001, 2019); });
      act(() => { result.current.advanceRound(); });

      expect(result.current.phase).toBe('submitting_final');
      expect(result.current.picks).toHaveLength(2);
    });
  });

  describe('submitFinal', () => {
    it('calls completeGame API and transitions to complete', async () => {
      vi.mocked(api.completeGame).mockResolvedValue({
        totalLegendScore: 8.8,
        percentile: 75,
        totalParticipants: 100,
        communityStats: [],
        perfectLineup: { picks: [], totalScore: 10 },
      });

      const { result } = await loadToPickingPhase();

      // Play through both rounds
      act(() => { result.current.submitPick(1001, 2020); });
      act(() => { result.current.advanceRound(); });
      act(() => { result.current.submitPick(2001, 2019); });
      act(() => { result.current.advanceRound(); });

      expect(result.current.phase).toBe('submitting_final');

      await act(async () => {
        await result.current.submitFinal();
      });

      expect(result.current.phase).toBe('complete');
      expect(api.completeGame).toHaveBeenCalledWith(
        1, // challengeId
        'session-abc',
        expect.arrayContaining([
          expect.objectContaining({ roundId: 100, playerRecordId: 1001, year: 2020 }),
          expect.objectContaining({ roundId: 200, playerRecordId: 2001, year: 2019 }),
        ]),
      );
      expect(result.current.completeResponse?.totalLegendScore).toBe(8.8);
    });

    it('clears localStorage on successful completion', async () => {
      vi.mocked(api.completeGame).mockResolvedValue({
        totalLegendScore: 8.8,
        percentile: 75,
        totalParticipants: 100,
        communityStats: [],
        perfectLineup: { picks: [], totalScore: 10 },
      });

      const { result } = await loadToPickingPhase();

      act(() => { result.current.submitPick(1001, 2020); });
      act(() => { result.current.advanceRound(); });
      act(() => { result.current.submitPick(2001, 2019); });
      act(() => { result.current.advanceRound(); });

      await act(async () => {
        await result.current.submitFinal();
      });

      expect(gameStorage.clearSavedGame).toHaveBeenCalled();
    });

    it('stays in submitting_final with error on API failure', async () => {
      vi.mocked(api.completeGame).mockRejectedValue(new Error('Server error'));

      const { result } = await loadToPickingPhase();

      act(() => { result.current.submitPick(1001, 2020); });
      act(() => { result.current.advanceRound(); });
      act(() => { result.current.submitPick(2001, 2019); });
      act(() => { result.current.advanceRound(); });

      await act(async () => {
        await result.current.submitFinal();
      });

      expect(result.current.phase).toBe('submitting_final');
      expect(result.current.error).toBe('Server error');
      expect(gameStorage.clearSavedGame).not.toHaveBeenCalled();
    });
  });

  describe('playtest mode', () => {
    it('loads and identifies as playtest', async () => {
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

    it('does not save to localStorage during picks', async () => {
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

      expect(gameStorage.saveGame).not.toHaveBeenCalled();
    });

    it('computes results client-side on submitFinal (no API call)', async () => {
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

      // Play through both rounds
      act(() => { result.current.submitPick(1001, 2020); });
      act(() => { result.current.advanceRound(); });
      act(() => { result.current.submitPick(2001, 2019); });
      act(() => { result.current.advanceRound(); });

      await act(async () => {
        await result.current.submitFinal();
      });

      expect(result.current.phase).toBe('complete');
      expect(api.completeGame).not.toHaveBeenCalled();

      // Should have client-computed results: 4.0 + 4.8 = 8.8
      expect(result.current.playtestResults).not.toBeNull();
      expect(result.current.playtestResults?.session.totalLegendScore).toBe(8.8);
      expect(result.current.playtestResults?.picks).toHaveLength(2);
      expect(result.current.playtestResults?.perfectLineup.picks).toHaveLength(2);
    });
  });
});
