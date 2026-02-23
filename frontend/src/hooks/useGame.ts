import { useState, useCallback, useRef } from 'react';
import type { Challenge, RoundData, RoundCommunityStats, RevealData, PickSummary, PickSubmission, CompleteResponse, ResultsData, ResultsPick, PerfectLineupPick } from '../types';
import { calculateSandlotScore } from '../lib/sandlotScore';
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
  playtestResults: ResultsData | null;
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
  playtestResults: null,
  error: null,
};

function isPlaytestSession(sessionId: string | null): boolean {
  return !!sessionId && sessionId.startsWith('playtest-');
}

function isReplaySession(sessionId: string | null): boolean {
  return !!sessionId && sessionId.startsWith('replay-');
}

function isVirtualSession(sessionId: string | null): boolean {
  return isPlaytestSession(sessionId) || isReplaySession(sessionId);
}

export function useGame() {
  const [state, setState] = useState<GameState>(initialState);
  const submittingRef = useRef(false);

  const isPlaytest = isPlaytestSession(state.sessionId);
  const isReplay = isReplaySession(state.sessionId);

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

  // Replay: load a completed challenge by ID via public API, no real session
  const loadReplay = useCallback(async (challengeId: number) => {
    setState(s => ({ ...s, phase: 'loading', error: null }));

    try {
      const data = await api.startReplay(challengeId);

      setState(s => ({
        ...s,
        phase: 'picking',
        challenge: data.challenge,
        sessionId: data.session.id, // "replay-{id}-{timestamp}"
        rounds: data.rounds,
        communityStats: data.communityStats,
        currentRoundIndex: 0,
        picks: [],
        pickSubmissions: [],
      }));
      // No localStorage save for replay
    } catch (err) {
      setState(s => ({ ...s, phase: 'idle', error: (err as Error).message }));
    }
  }, []);

  // Synchronous pick: compute Sandlot Score locally, build reveal data, save to localStorage
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

      // Compute Sandlot Score client-side
      const legendScore = calculateSandlotScore(selectedYearOption.zScorePosition);

      // Build reveal data
      const blurb = selectedPlayer.blurbs[String(year)] || '';

      // Get community stats for this round (snapshot from game start)
      const roundStats = prev.communityStats.find(s => s.roundId === round.roundId);

      // Adjust community stats to include the user's own pick
      let adjustedPicks = roundStats?.picks;
      if (roundStats && roundStats.totalPicks != null) {
        const newTotal = roundStats.totalPicks + 1;
        const existingIdx = roundStats.picks.findIndex(
          p => p.playerId === playerRecordId && p.year === year
        );
        let updatedPicks;
        if (existingIdx >= 0) {
          updatedPicks = roundStats.picks.map((p, i) =>
            i === existingIdx ? { ...p, count: (p.count ?? 0) + 1 } : p
          );
        } else {
          updatedPicks = [...roundStats.picks, { playerId: playerRecordId, year, count: 1, percentage: 0 }];
        }
        adjustedPicks = updatedPicks.map(p => ({
          ...p,
          percentage: newTotal > 0 ? Math.round(((p.count ?? 0) / newTotal) * 100) : 0,
        }));
      }

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
        portraitUrl: selectedPlayer.portraitUrl,
        year,
        team: selectedYearOption.team,
        pickPercentages: adjustedPicks,
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

      // Save to localStorage (skip for playtest/replay)
      if (prev.challenge && !isVirtualSession(prev.sessionId)) {
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

    // Playtest/Replay: skip server submission, compute results client-side
    if (isVirtualSession(state.sessionId)) {
      const totalScore = state.picks.reduce((sum, p) => sum + p.legendScore, 0);
      const roundedTotal = Math.round(totalScore * 10) / 10;

      // Build enriched ResultsPick[] by matching picks with round data
      const resultsPicks: ResultsPick[] = state.picks.map((pick, i) => {
        const submission = state.pickSubmissions[i];
        const round = state.rounds.find(r => r.roundNumber === pick.roundNumber);
        let team = '';
        let stats: Record<string, number> = {};
        let portraitUrl: string | null = null;
        let blurb: string | undefined;
        let categoryZscores: Record<string, number> | undefined;
        let playerType: 'batter' | 'pitcher' | undefined;
        if (round && submission) {
          for (const player of round.players) {
            const yo = player.yearOptions.find(
              y => y.playerRecordId === submission.playerRecordId && y.year === submission.year
            );
            if (yo) {
              team = yo.team;
              stats = yo.stats;
              portraitUrl = player.portraitUrl;
              blurb = player.blurbs?.[String(yo.year)];
              categoryZscores = yo.categoryZscores;
              playerType = yo.playerType;
              break;
            }
          }
        }
        return {
          roundNumber: pick.roundNumber,
          position: pick.position,
          playerName: pick.playerName,
          year: pick.year,
          team,
          legendScore: pick.legendScore,
          stats,
          wasTimeout: submission?.wasTimeout ?? false,
          portraitUrl,
          blurb,
          categoryZscores,
          playerType,
        };
      });

      // Compute perfect lineup: best option from each round
      const perfectPicks: PerfectLineupPick[] = state.rounds.map(round => {
        let bestScore = -Infinity;
        let bestPick: PerfectLineupPick = {
          roundNumber: round.roundNumber,
          position: round.position,
          playerName: '',
          year: 0,
          legendScore: 0,
        };
        for (const player of round.players) {
          for (const yo of player.yearOptions) {
            const ls = calculateSandlotScore(yo.zScorePosition);
            if (ls > bestScore) {
              bestScore = ls;
              bestPick = {
                roundNumber: round.roundNumber,
                position: round.position,
                playerName: player.name,
                year: yo.year,
                legendScore: ls,
                team: yo.team,
                stats: yo.stats,
                playerType: yo.playerType,
                blurb: player.blurbs?.[String(yo.year)],
                categoryZscores: yo.categoryZscores,
              };
            }
          }
        }
        return bestPick;
      });
      const perfectTotal = Math.round(perfectPicks.reduce((sum, p) => sum + p.legendScore, 0) * 10) / 10;

      // Replay: fetch real percentile from server; playtest: use zeros
      let percentile = 0;
      let totalParticipants = 0;
      if (isReplaySession(state.sessionId) && state.challenge) {
        try {
          const pctData = await api.getReplayPercentile(state.challenge.id, roundedTotal);
          percentile = pctData.percentile;
          totalParticipants = pctData.totalParticipants;
        } catch { /* fall back to 0 */ }
      }

      const playtestResults: ResultsData = {
        session: {
          totalLegendScore: roundedTotal,
          percentile,
          completedAt: new Date().toISOString(),
        },
        picks: resultsPicks,
        perfectLineup: { picks: perfectPicks, totalScore: perfectTotal },
        totalParticipants,
        communityStats: state.communityStats,
      };

      setState(s => ({
        ...s,
        phase: 'complete',
        playtestResults,
        completeResponse: {
          totalLegendScore: roundedTotal,
          percentile,
          totalParticipants,
          communityStats: [],
          perfectLineup: { picks: perfectPicks, totalScore: perfectTotal },
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
  }, [state.challenge, state.sessionId, state.pickSubmissions, state.picks, state.communityStats, state.rounds]);

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
    playtestResults: state.playtestResults,
    roundNumber,
    totalRounds,
    error: state.error,
    isSubmitting: submittingRef,
    isPlaytest,
    isReplay,
    loadAndStart,
    loadPlaytest,
    loadReplay,
    submitPick,
    advanceRound,
    submitFinal,
  };
}
