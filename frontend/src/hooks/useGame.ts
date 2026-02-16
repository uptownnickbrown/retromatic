import { useState, useCallback, useRef } from 'react';
import type { RoundData, RevealData, Challenge, PickSummary } from '../types';
import * as api from '../lib/api';

export type GamePhase =
  | 'loading'
  | 'idle'
  | 'picking'
  | 'submitting'
  | 'revealing'
  | 'complete';

interface GameState {
  phase: GamePhase;
  challenge: Challenge | null;
  sessionId: string | null;
  currentRound: RoundData | null;
  reveal: RevealData | null;
  picks: PickSummary[];
  roundNumber: number;
  totalRounds: number;
  error: string | null;
}

const initialState: GameState = {
  phase: 'loading',
  challenge: null,
  sessionId: null,
  currentRound: null,
  reveal: null,
  picks: [],
  roundNumber: 0,
  totalRounds: 10,
  error: null,
};

export function useGame() {
  const [state, setState] = useState<GameState>(initialState);
  const submittingRef = useRef(false);

  const loadChallenge = useCallback(async () => {
    setState(s => ({ ...s, phase: 'loading', error: null }));
    try {
      const { challenge, session } = await api.getTodaysChallenge();
      if (!challenge) {
        setState(s => ({ ...s, phase: 'idle', challenge: null, error: 'No challenge available today. Check back tomorrow!' }));
        return;
      }
      if (session?.status === 'completed') {
        setState(s => ({
          ...s,
          phase: 'complete',
          challenge,
          sessionId: session.id,
          picks: session.picks,
          totalRounds: challenge.totalRounds,
          roundNumber: challenge.totalRounds,
        }));
        return;
      }
      if (session?.status === 'in_progress') {
        // Resume: need to re-start to get current round data
        setState(s => ({ ...s, phase: 'idle', challenge, sessionId: session.id, picks: session.picks, roundNumber: session.currentRound }));
        return;
      }
      setState(s => ({ ...s, phase: 'idle', challenge, totalRounds: challenge.totalRounds }));
    } catch (err) {
      setState(s => ({ ...s, phase: 'idle', error: (err as Error).message }));
    }
  }, []);

  const startGame = useCallback(async () => {
    if (!state.challenge) return;
    setState(s => ({ ...s, phase: 'loading', error: null }));
    try {
      const { session, round } = await api.startGame(state.challenge.id);
      // Server returned a completed session — go straight to results
      if (session.status === 'completed' || !round) {
        setState(s => ({
          ...s,
          phase: 'complete',
          sessionId: session.id,
        }));
        return;
      }
      setState(s => ({
        ...s,
        phase: 'picking',
        sessionId: session.id,
        currentRound: round,
        roundNumber: round.roundNumber,
      }));
    } catch (err) {
      setState(s => ({ ...s, phase: 'idle', error: (err as Error).message }));
    }
  }, [state.challenge]);

  const submitPick = useCallback(async (playerId: number, year: number, wasTimeout = false) => {
    if (!state.challenge || !state.sessionId || !state.currentRound || submittingRef.current) return;
    submittingRef.current = true;
    setState(s => ({ ...s, phase: 'submitting' }));
    try {
      const { reveal, nextRound } = await api.submitPick(
        state.challenge.id,
        state.sessionId,
        state.currentRound.roundId,
        playerId,
        year,
        wasTimeout,
      );
      const newPick: PickSummary = {
        roundNumber: state.currentRound.roundNumber,
        position: state.currentRound.position,
        playerName: reveal.playerName,
        year: reveal.year,
        legendScore: reveal.legendScore,
      };
      setState(s => ({
        ...s,
        phase: 'revealing',
        reveal,
        picks: [...s.picks, newPick],
        currentRound: nextRound,
      }));
    } catch (err) {
      setState(s => ({ ...s, phase: 'picking', error: (err as Error).message }));
    } finally {
      submittingRef.current = false;
    }
  }, [state.challenge, state.sessionId, state.currentRound]);

  const advanceRound = useCallback(() => {
    if (state.currentRound) {
      setState(s => ({
        ...s,
        phase: 'picking',
        reveal: null,
        roundNumber: state.currentRound!.roundNumber,
      }));
    } else {
      setState(s => ({
        ...s,
        phase: 'complete',
        reveal: null,
        roundNumber: s.totalRounds,
      }));
    }
  }, [state.currentRound]);

  return {
    ...state,
    isSubmitting: submittingRef,
    loadChallenge,
    startGame,
    submitPick,
    advanceRound,
  };
}
