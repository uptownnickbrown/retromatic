import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';

export function usePlayerSearch(
  query: string,
  position?: string,
  year?: number,
  enabled: boolean = true
) {
  return useQuery({
    queryKey: ['playerSearch', query, position, year],
    queryFn: () => api.searchPlayers(query, position, year),
    enabled: enabled && query.length >= 2,
    staleTime: 30000, // Cache for 30 seconds
  });
}

export function usePlayer(id: number | null) {
  return useQuery({
    queryKey: ['player', id],
    queryFn: () => api.getPlayer(id!),
    enabled: id !== null,
  });
}
