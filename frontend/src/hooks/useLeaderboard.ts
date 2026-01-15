import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';

export function useLeaderboard(
  limit?: number,
  period?: 'all' | 'week' | 'month'
) {
  return useQuery({
    queryKey: ['leaderboard', limit, period],
    queryFn: () => api.getLeaderboard(limit, period),
    staleTime: 60000, // Cache for 1 minute
  });
}

export function useUserDrafts() {
  return useQuery({
    queryKey: ['userDrafts'],
    queryFn: api.getUserDrafts,
    staleTime: 30000,
  });
}

export function useUserRank() {
  return useQuery({
    queryKey: ['userRank'],
    queryFn: api.getUserRank,
    staleTime: 30000,
  });
}
