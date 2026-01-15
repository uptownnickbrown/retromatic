import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDraft, useMakePick, useCompleteDraft } from "../hooks/useDraft";
import { PlayerSearch } from "../components/draft/PlayerSearch";
import { RosterPanel } from "../components/draft/RosterPanel";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ROSTER_CONFIG } from "../types";

export function Draft() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const draftId = id ? parseInt(id) : null;

  const { data: draft, isLoading, error } = useDraft(draftId);
  const makePick = useMakePick(draftId || 0);
  const completeDraft = useCompleteDraft(draftId || 0);

  const [selectedSlot, setSelectedSlot] = React.useState<string | null>(null);
  const [pendingPlayer, setPendingPlayer] = React.useState<{ id: number; name: string } | null>(null);

  // Auto-select first available slot
  React.useEffect(() => {
    if (draft?.availableSlots.length && !selectedSlot) {
      setSelectedSlot(draft.availableSlots[0]);
    }
  }, [draft?.availableSlots, selectedSlot]);

  // Handle draft completion redirect
  React.useEffect(() => {
    if (draft?.status === 'completed') {
      navigate(`/results/${draftId}`);
    }
  }, [draft?.status, draftId, navigate]);

  const handleSelectPlayer = async (playerId: number, playerName: string) => {
    if (!selectedSlot) {
      // If no slot selected, show slot selection
      setPendingPlayer({ id: playerId, name: playerName });
      return;
    }

    try {
      await makePick.mutateAsync({ playerId, rosterSlot: selectedSlot });
      setPendingPlayer(null);
      // Move to next available slot
      const currentIndex = draft?.availableSlots.indexOf(selectedSlot) || 0;
      const nextSlot = draft?.availableSlots[currentIndex + 1] || draft?.availableSlots[0];
      setSelectedSlot(nextSlot || null);
    } catch (err) {
      console.error('Failed to make pick:', err);
    }
  };

  const handleCompleteDraft = async () => {
    try {
      const result = await completeDraft.mutateAsync();
      navigate(`/results/${draftId}`);
    } catch (err) {
      console.error('Failed to complete draft:', err);
    }
  };

  // Get player type filter based on selected slot
  const getPlayerTypeFilter = (): 'batter' | 'pitcher' | undefined => {
    if (!selectedSlot) return undefined;
    const slot = ROSTER_CONFIG.find(s => s.id === selectedSlot);
    return slot?.playerType;
  };

  // Get already drafted player IDs
  const draftedPlayerIds = React.useMemo(() => {
    return draft?.picks.map(p => p.playerId) || [];
  }, [draft?.picks]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-sepia border-t-transparent rounded-full mx-auto mb-4" />
          <div className="font-body text-dirt">Loading draft...</div>
        </div>
      </div>
    );
  }

  if (error || !draft) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="py-8 text-center">
            <div className="text-red-600 mb-4">
              {error?.message || 'Draft not found'}
            </div>
            <Button onClick={() => navigate('/')}>Back to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isComplete = draft.pickCount >= 15;

  return (
    <div className="min-h-screen bg-gradient-to-b from-cream to-cardboard/20">
      {/* Header */}
      <header className="bg-pinstripe text-chalk py-4 px-4 sticky top-0 z-10">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="font-display text-xl font-bold hover:text-gold transition-colors">
              Retromatic
            </button>
            <span className="text-chalk/60">|</span>
            <span className="font-body">Draft #{draft.id}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-lg">
              {draft.pickCount}/15 picks
            </span>
            {isComplete && (
              <Button
                onClick={handleCompleteDraft}
                disabled={completeDraft.isPending}
                className="bg-grass hover:bg-grass/90"
              >
                {completeDraft.isPending ? 'Finalizing...' : 'Complete Draft'}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Search Panel */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  {selectedSlot
                    ? `Select a ${getPlayerTypeFilter() === 'pitcher' ? 'pitcher' : 'batter'} for ${selectedSlot}`
                    : 'Select a roster slot first'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PlayerSearch
                  onSelectPlayer={handleSelectPlayer}
                  filterPlayerType={getPlayerTypeFilter()}
                  disabledPlayerIds={draftedPlayerIds}
                />

                {makePick.isError && (
                  <div className="mt-4 p-4 bg-red-100 border border-red-300 rounded-md text-red-800">
                    {(makePick.error as Error).message}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Instructions */}
            {draft.pickCount === 0 && (
              <Card className="mt-6">
                <CardContent className="py-6">
                  <h3 className="font-display text-lg font-semibold text-sepia mb-2">
                    How to Draft
                  </h3>
                  <ul className="space-y-2 font-body text-dirt">
                    <li className="flex gap-2">
                      <span className="text-sepia">1.</span>
                      Click a roster slot on the right to select it
                    </li>
                    <li className="flex gap-2">
                      <span className="text-sepia">2.</span>
                      Search for players by name above
                    </li>
                    <li className="flex gap-2">
                      <span className="text-sepia">3.</span>
                      Click a player to add them to your roster
                    </li>
                    <li className="flex gap-2">
                      <span className="text-sepia">4.</span>
                      Fill all 15 slots, then complete your draft!
                    </li>
                  </ul>
                  <p className="mt-4 text-sm text-dirt/70">
                    Note: Player stats are hidden during the draft. You'll see how your
                    picks performed once you complete the draft!
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Roster Panel */}
          <div className="lg:col-span-1">
            <div className="sticky top-24">
              <RosterPanel
                picks={draft.picks}
                selectedSlot={selectedSlot}
                onSelectSlot={setSelectedSlot}
                availableSlots={draft.availableSlots}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
