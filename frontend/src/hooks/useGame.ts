import { useState, useCallback, useRef } from 'react';
import type { Challenge, RoundData, RoundCommunityStats, RevealData, PickSummary, PickSubmission, CompleteResponse } from '../types';
import { calculateLegendScore } from '../lib/legendScore';
import { saveGame, loadSavedGame, clearSavedGame } from '../lib/gameStorage';
import * as api from '../lib/api';
import * as adminApi from '../lib/adminApi';

export type GamePhase =
  | 'loading'
  | 'idle'
  | 'picking'
  | 'revealing'
  | 'submitting_final'
  | 'complete';

interface GameState {
  phase: GamePhase;
  challenge: Challenge | null;
  sessionId: string | null;
  rounds: RoundData[];
  communityStats: RoundCommunityStats[];
  currentRoundIndex: number;
  reveal: RevealData | null;
  picks: PickSummary[];
  pickSubmissions: PickSubmission[];
  completeResponse: CompleteResponse | null;
  error: string | null;
}

const initialState: GameState = {
  phase: 'loading',
  challenge: null,
  sessionId: null,
  rounds: [],
  communityStats: [],
  currentRoundIndex: 0,
  reveal: null,
  picks: [],
  pickSubmissions: [],
  completeResponse: null,
  error: null,
};

function isPlaytestSession(sessionId: string | null): boolean {
  return !!sessionId && sessionId.startsWith('playtest-');
}

export function useGame() {
  const [state, setState] = useState<GameState>(initialState);
  const submittingRef = useRef(false);

  const isPlaytest = isPlaytestSession(state.sessionId);

  // Combined load + start: check localStorage first, then fetch from server
  const loadAndStart = useCallback(async () => {
    setState(s => ({ ...s, phase: 'loading', error: null }));

    try {
      // 1. Check localStorage for a saved game
      const saved = loadSavedGame();

      // 2. Fetch today's challenge status from server
      const { challenge, session } = await api.getTodaysChallenge();

      if (!challenge) {
        setState(s => ({ ...s, phase: 'idle', challenge: null, error: 'No challenge available today. Check back tomorrow!' }));
        return;
      }

      // Already completed — go to results
      if (session?.status === 'completed') {
        setState(s => ({
          ...s,
          phase: 'complete',
          challenge,
          sessionId: session.id,
        }));
        return;
      }

      // Check if we have valid saved state for this challenge
      if (saved && saved.challengeId === challenge.id && saved.rounds.length > 0) {
        // Resume from localStorage
        setState(s => ({
          ...s,
          phase: saved.currentRoundIndex >= saved.rounds.length ? 'submitting_final' : 'picking',
          challenge,
          sessionId: saved.sessionId,
          rounds: saved.rounds,
          communityStats: saved.communityStats,
          currentRoundIndex: saved.currentRoundIndex,
          picks: saved.picks,
          pickSubmissions: saved.pickSubmissions,
        }));
        return;
      }

      // Fresh start: fetch all round data from server
      const data = await api.startGame(challenge.id);

      if (data.session.status === 'completed') {
        setState(s => ({ ...s, phase: 'complete', challenge, sessionId: data.session.id }));
        return;
      }

      // Save initial state to localStorage
      saveGame({
        challengeId: challenge.id,
        challengeDate: challenge.date,
        sessionId: data.session.id,
        rounds: data.rounds,
        communityStats: data.communityStats,
        currentRoundIndex: 0,
        picks: [],
        pickSubmissions: [],
      });

      setState(s => ({
        ...s,
        phase: 'picking',
        challenge,
        sessionId: data.session.id,
        rounds: data.rounds,
        communityStats: data.communityStats,
        currentRoundIndex: 0,
        picks: [],
        pickSubmissions: [],
      }));
    } catch (err) {
      setState(s => ({ ...s, phase: 'idle', error: (err as Error).message }));
    }
  }, []);

  // Playtest: load a challenge by ID via admin API, no real session
  const loadPlaytest = useCallback(async (challengeId: number) => {
    setState(s => ({ ...s, phase: 'loading', error: null }));

    try {
      const data = await adminApi.startPlaytest(challengeId);

      setState(s => ({
        ...s,
        phase: 'picking',
        challenge: data.challenge,
        sessionId: data.session.id, // "playtest-{id}-{timestamp}"
        rounds: data.rounds,
        communityStats: data.communityStats,
        currentRoundIndex: 0,
        picks: [],
        pickSubmissions: [],
      }));
      // No localStorage save for playtest
    } catch (err) {
      setState(s => ({ ...s, phase: 'idle', error: (err as Error).message }));
    }
  }, []);

  // Synchronous pick: compute Legend Score locally, build reveal data, save to localStorage
  const submitPick = useCallback((playerRecordId: number, year: number, wasTimeout = false) => {
    if (submittingRef.current) return;

    setState(prev => {
      const round = prev.rounds[prev.currentRoundIndex];
      if (!round) return prev;

      // Find the selected player + year option from enriched round data
      let selectedPlayer = null;
      let selectedYearOption = null;
      for (const player of round.players) {
        for (const yo of player.yearOptions) {
          if (yo.playerRecordId === playerRecordId && yo.year === year) {
            selectedPlayer = player;
            selectedYearOption = yo;
            break;
          }
        }
        if (selectedPlayer) break;
      }

      if (!selectedPlayer || !selectedYearOption) return prev;

      // Compute Legend Score client-side
      const legendScore = calculateLegendScore(selectedYearOption.zScorePosition);

      // Build reveal data
      const blurb = selectedPlayer.blurbs[String(year)] || '';

      // Get community stats for this round (snapshot from game start)
      const roundStats = prev.communityStats.find(s => s.roundId === round.roundId);

      // Build round players info for community picks display
      const roundPlayers = round.players.map(p => ({
        name: p.name,
        portraitUrl: p.portraitUrl,
        yearOptions: p.yearOptions.map(yo => ({ year: yo.year, team: yo.team, playerRecordId: yo.playerRecordId })),
      }));

      const reveal: RevealData = {
        legendScore,
        blurb,
        stats: selectedYearOption.stats,
        categoryZscores: selectedYearOption.categoryZscores,
        playerType: selectedYearOption.playerType,
        playerName: selectedPlayer.name,
        year,
        team: selectedYearOption.team,
        pickPercentages: roundStats?.picks,
        roundPlayers,
      };

      const newPick: PickSummary = {
        roundNumber: round.roundNumber,
        position: round.position,
        playerName: selectedPlayer.name,
        year,
        legendScore,
      };

      const newSubmission: PickSubmission = {
        roundId: round.roundId,
        playerRecordId,
        year,
        wasTimeout,
      };

      const newPicks = [...prev.picks, newPick];
      const newSubmissions = [...prev.pickSubmissions, newSubmission];
      const newRoundIndex = prev.currentRoundIndex + 1;

      // Save to localStorage (skip for playtest)
      if (prev.challenge && !isPlaytestSession(prev.sessionId)) {
        saveGame({
          challengeId: prev.challenge.id,
          challengeDate: prev.challenge.date,
          sessionId: prev.sessionId!,
          rounds: prev.rounds,
          communityStats: prev.communityStats,
          currentRoundIndex: newRoundIndex,
          picks: newPicks,
          pickSubmissions: newSubmissions,
        });
      }

      return {
        ...prev,
        phase: 'revealing' as const,
        reveal,
        picks: newPicks,
        pickSubmissions: newSubmissions,
        currentRoundIndex: newRoundIndex,
      };
    });
  }, []);

  // Advance to next round or trigger final submission
  const advanceRound = useCallback(() => {
    setState(prev => {
      if (prev.currentRoundIndex >= prev.rounds.length) {
        // All rounds done — trigger final submission
        return { ...prev, phase: 'submitting_final' as const, reveal: null };
      }
      return { ...prev, phase: 'picking' as const, reveal: null };
    });
  }, []);

  // Submit all picks to server at once
  const submitFinal = useCallback(async () => {
    if (!state.challenge || !state.sessionId || submittingRef.current) return;
    submittingRef.current = true;

    // Playtest: skip server submission, compute results client-side
    if (isPlaytestSession(state.sessionId)) {
      const totalScore = state.picks.reduce((sum, p) => sum + p.legendScore, 0);
      const roundedTotal = Math.round(totalScore * 10) / 10;

      setState(s => ({
        ...s,
        phase: 'complete',
        completeResponse: {
          totalLegendScore: roundedTotal,
          percentile: 0,
          totalParticipants: 0,
          communityStats: [],
          perfectLineup: { picks: [], totalScore: 0 },
        },
      }));
      submittingRef.current = false;
      return;
    }

    try {
      const response = await api.completeGame(
        state.challenge.id,
        state.sessionId,
        state.pickSubmissions,
      );

      clearSavedGame();

      setState(s => ({
        ...s,
        phase: 'complete',
        completeResponse: response,
      }));
    } catch (err) {
      setState(s => ({ ...s, phase: 'submitting_final', error: (err as Error).message }));
    } finally {
      submittingRef.current = false;
    }
  }, [state.challenge, state.sessionId, state.pickSubmissions, state.picks]);

  // Derived values
  const currentRound = state.rounds[state.currentRoundIndex] ?? null;
  const roundNumber = currentRound?.roundNumber ?? (state.picks.length > 0 ? state.picks.length : 0);
  const totalRounds = state.rounds.length || 10;

  return {
    phase: state.phase,
    challenge: state.challenge,
    sessionId: state.sessionId,
    currentRound,
    reveal: state.reveal,
    picks: state.picks,
    completeResponse: state.completeResponse,
    roundNumber,
    totalRounds,
    error: state.error,
    isSubmitting: submittingRef,
    isPlaytest,
    loadAndStart,
    loadPlaytest,
    submitPick,
    advanceRound,
    submitFinal,
  };
}
