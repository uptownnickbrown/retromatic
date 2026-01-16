import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
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
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-gold border-t-transparent rounded-full mx-auto mb-4" />
          <div className="font-body text-cream/60">Loading draft...</div>
        </div>
      </div>
    );
  }

  if (error || !draft) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="py-8 text-center">
            <div className="text-red mb-4">
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
    <div className="min-h-screen bg-navy">
      {/* Header */}
      <header className="bg-navy-light border-b border-cream/10 py-4 px-4 sticky top-0 z-10">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="font-display text-xl font-bold text-cream hover:text-gold transition-colors">
              RETRO<span className="text-gold">MATIC</span>
            </button>
            <span className="text-cream/30">|</span>
            <span className="font-body text-cream/60">Draft #{draft.id}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xl font-bold text-gold">
                {draft.pickCount}
              </span>
              <span className="text-cream/60">/15 picks</span>
            </div>
            {isComplete && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300 }}
              >
                <Button
                  onClick={handleCompleteDraft}
                  disabled={completeDraft.isPending}
                  className="bg-grass hover:bg-grass-light pulse-glow"
                >
                  {completeDraft.isPending ? 'Finalizing...' : 'Complete Draft'}
                </Button>
              </motion.div>
            )}
          </div>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="h-1 bg-navy-light">
        <motion.div
          className="h-full bg-gradient-to-r from-gold to-gold-light"
          initial={{ width: 0 }}
          animate={{ width: `${(draft.pickCount / 15) * 100}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Search Panel */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  {selectedSlot ? (
                    <>
                      <span className="px-3 py-1 bg-gold/20 text-gold rounded-lg font-mono">
                        {selectedSlot}
                      </span>
                      <span>
                        Select a {getPlayerTypeFilter() === 'pitcher' ? 'pitcher' : 'batter'}
                      </span>
                    </>
                  ) : (
                    'Select a roster slot first'
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PlayerSearch
                  onSelectPlayer={handleSelectPlayer}
                  filterPlayerType={getPlayerTypeFilter()}
                  disabledPlayerIds={draftedPlayerIds}
                />

                {makePick.isError && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 p-4 bg-red/20 border border-red/30 rounded-lg text-red-light"
                  >
                    {(makePick.error as Error).message}
                  </motion.div>
                )}
              </CardContent>
            </Card>

            {/* Instructions */}
            {draft.pickCount === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <Card className="mt-6">
                  <CardContent className="py-6">
                    <h3 className="font-display text-lg font-semibold text-gold mb-4">
                      How to Draft
                    </h3>
                    <ul className="space-y-3 font-body text-cream/70">
                      <li className="flex gap-3 items-start">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gold/20 text-gold flex items-center justify-center text-sm font-mono">1</span>
                        <span>Click a roster slot on the right to select it</span>
                      </li>
                      <li className="flex gap-3 items-start">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gold/20 text-gold flex items-center justify-center text-sm font-mono">2</span>
                        <span>Search for players by name above</span>
                      </li>
                      <li className="flex gap-3 items-start">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gold/20 text-gold flex items-center justify-center text-sm font-mono">3</span>
                        <span>Click a player to add them to your roster</span>
                      </li>
                      <li className="flex gap-3 items-start">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gold/20 text-gold flex items-center justify-center text-sm font-mono">4</span>
                        <span>Fill all 15 slots, then complete your draft!</span>
                      </li>
                    </ul>
                    <div className="mt-6 p-4 rounded-lg bg-grass/10 border border-grass/20">
                      <p className="text-sm text-grass-light flex items-start gap-2">
                        <span className="text-lg">🎯</span>
                        <span>
                          <strong>The Challenge:</strong> Player stats are hidden during the draft.
                          You'll see how your picks performed once you complete the draft!
                        </span>
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
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
