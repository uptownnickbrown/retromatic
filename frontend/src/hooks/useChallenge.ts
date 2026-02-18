import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';

export function useTodaysChallenge() {
  return useQuery({
    queryKey: ['challenge', 'today'],
    queryFn: api.getTodaysChallenge,
    staleTime: 60_000,
  });
}

export function useChallengeResults(challengeId: number | null) {
  return useQuery({
    queryKey: ['results', challengeId],
    queryFn: () => api.getChallengeResults(challengeId!),
    enabled: !!challengeId,
    staleTime: 30_000,
  });
}

export function useStreak() {
  return useQuery({
    queryKey: ['streak'],
    queryFn: api.getStreak,
    staleTime: 60_000,
  });
}
