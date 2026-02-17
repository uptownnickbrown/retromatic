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

export function useScheduleChallenges() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ challengeIds, startDate }: { challengeIds: number[]; startDate: string }) =>
      adminApi.scheduleChallenges(challengeIds, startDate),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] }),
  });
}

export function useActivateToday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.activateToday(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] }),
  });
}
