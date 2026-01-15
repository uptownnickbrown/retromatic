import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';

export function useDraft(draftId: number | null) {
  return useQuery({
    queryKey: ['draft', draftId],
    queryFn: () => api.getDraft(draftId!),
    enabled: draftId !== null,
    refetchInterval: false,
  });
}

export function useCreateDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createDraft,
    onSuccess: (data) => {
      queryClient.setQueryData(['draft', data.draftId], data);
    },
  });
}

export function useMakePick(draftId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ playerId, rosterSlot }: { playerId: number; rosterSlot: string }) =>
      api.makePick(draftId, playerId, rosterSlot),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['draft', draftId] });
    },
  });
}

export function useCompleteDraft(draftId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.completeDraft(draftId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['draft', draftId] });
      queryClient.invalidateQueries({ queryKey: ['draftResults', draftId] });
    },
  });
}

export function useDraftResults(draftId: number | null) {
  return useQuery({
    queryKey: ['draftResults', draftId],
    queryFn: () => api.getDraftResults(draftId!),
    enabled: draftId !== null,
  });
}
