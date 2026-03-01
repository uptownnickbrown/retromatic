import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as adminApi from '../lib/adminApi';

export function useAdminPipeline() {
  return useQuery({
    queryKey: ['admin', 'pipeline'],
    queryFn: adminApi.getPipeline,
    staleTime: 10_000,
    enabled: adminApi.isAdminAuthenticated(),
  });
}

export function useAdminHistory() {
  return useQuery({
    queryKey: ['admin', 'history'],
    queryFn: adminApi.getHistory,
    staleTime: 10_000,
    enabled: adminApi.isAdminAuthenticated(),
  });
}

export function useAdminChallengeDetail(id: number | null) {
  return useQuery({
    queryKey: ['admin', 'challenge', id],
    queryFn: () => adminApi.getChallengeDetail(id!),
    enabled: !!id && adminApi.isAdminAuthenticated(),
    staleTime: 10_000,
  });
}

export function useAdminChallengeHealth(id: number | null) {
  return useQuery({
    queryKey: ['admin', 'health', id],
    queryFn: () => adminApi.getChallengeHealth(id!),
    enabled: !!id && adminApi.isAdminAuthenticated(),
    staleTime: 10_000,
  });
}

export function useGenerateChallenge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ count, theme }: { count?: number; theme?: string }) =>
      adminApi.generateChallenge(count, theme),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] }),
  });
}

export function useGenerateThemedBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (count: number) => adminApi.generateThemedBatch(count),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] }),
  });
}

export function useGenerateBlurbs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminApi.generateBlurbs(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['admin', 'health', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'challenge', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
    },
  });
}

export function usePreseedStats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, count }: { id: number; count?: number }) => adminApi.preseedStats(id, count),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'health', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
    },
  });
}

export function useGeneratePortraits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminApi.generatePortraits(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['admin', 'health', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'challenge', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
    },
  });
}

export function useUpdateChallenge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Parameters<typeof adminApi.updateChallenge>[1] }) =>
      adminApi.updateChallenge(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

export function useDeleteChallenge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminApi.deleteChallenge(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] }),
  });
}

export function useQueueChallenges() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (challengeIds: number[]) => adminApi.queueChallenges(challengeIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] }),
  });
}

export function useReorderQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (challengeIds: number[]) => adminApi.reorderQueue(challengeIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] }),
  });
}

export function useDequeueChallenges() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (challengeId: number) => adminApi.dequeueChallenges(challengeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] }),
  });
}

export function usePromoteNext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.promoteNext(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
      qc.invalidateQueries({ queryKey: ['admin', 'history'] });
    },
  });
}

export function useForceActivate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminApi.forceActivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
      qc.invalidateQueries({ queryKey: ['admin', 'history'] });
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
  });
}

export function useTodayStats() {
  return useQuery({
    queryKey: ['admin', 'stats', 'today'],
    queryFn: adminApi.getTodayStats,
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: adminApi.isAdminAuthenticated(),
  });
}

export function useHistoryStats(days = 30) {
  return useQuery({
    queryKey: ['admin', 'stats', 'history', days],
    queryFn: () => adminApi.getHistoryStats(days),
    staleTime: 60_000,
    enabled: adminApi.isAdminAuthenticated(),
  });
}

export function useBakeChallenge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminApi.bakeChallenge(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['admin', 'health', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'challenge', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
    },
  });
}

export function useValidatePortrait() {
  return useMutation({
    mutationFn: ({ playerId, validated }: { playerId: string; validated: boolean }) =>
      adminApi.validatePortrait(playerId, validated),
  });
}

export function useRegenerateOptionPortrait() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ optionId }: { optionId: number; challengeId: number; playerName: string }) =>
      adminApi.regenerateOptionPortrait(optionId),
    onSuccess: (_data, { challengeId }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'challenge', challengeId] });
      qc.invalidateQueries({ queryKey: ['admin', 'health', challengeId] });
      qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
    },
  });
}

export function useRegenerateOptionBlurbs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ optionId }: { optionId: number; challengeId: number }) =>
      adminApi.regenerateOptionBlurbs(optionId),
    onSuccess: (_data, { challengeId }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'challenge', challengeId] });
      qc.invalidateQueries({ queryKey: ['admin', 'health', challengeId] });
      qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
    },
  });
}

export function useUpdateOptionBlurb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ optionId, year, blurb }: { optionId: number; year: number; blurb: string; challengeId: number }) =>
      adminApi.updateOptionBlurb(optionId, year, blurb),
    onSuccess: (_data, { challengeId }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'challenge', challengeId] });
      qc.invalidateQueries({ queryKey: ['admin', 'health', challengeId] });
    },
  });
}

export function useConfirmReplacement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ optionId, playerId, playerName, yearOptions }: {
      optionId: number;
      playerId: string;
      playerName: string;
      yearOptions: number[];
      challengeId: number;
    }) => adminApi.confirmReplacement(optionId, playerId, playerName, yearOptions),
    onSuccess: (_data, { challengeId }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'challenge', challengeId] });
      qc.invalidateQueries({ queryKey: ['admin', 'health', challengeId] });
      qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
    },
  });
}
