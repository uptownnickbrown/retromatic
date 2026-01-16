import * as React from "react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { ROSTER_CONFIG, BATTER_SLOTS, PITCHER_SLOTS } from "../../types";
import type { DraftPick, RosterSlot } from "../../types";

interface RosterPanelProps {
  picks: DraftPick[];
  selectedSlot: string | null;
  onSelectSlot: (slotId: string) => void;
  availableSlots: string[];
}

export function RosterPanel({
  picks,
  selectedSlot,
  onSelectSlot,
  availableSlots,
}: RosterPanelProps) {
  const getPickForSlot = (slotId: string): DraftPick | undefined => {
    return picks.find(p => p.rosterSlot === slotId);
  };

  const renderSlot = (slot: RosterSlot) => {
    const pick = getPickForSlot(slot.id);
    const isAvailable = availableSlots.includes(slot.id);
    const isSelected = selectedSlot === slot.id;

    return (
      <button
        key={slot.id}
        onClick={() => isAvailable && onSelectSlot(slot.id)}
        disabled={!isAvailable && !pick}
        className={cn(
          "w-full px-3 py-2 rounded-lg border transition-all text-left",
          pick
            ? "border-grass/50 bg-grass/10"
            : isSelected
            ? "border-gold bg-gold/10 ring-2 ring-gold/30"
            : isAvailable
            ? "border-cream/20 hover:border-gold/50 hover:bg-gold/5 cursor-pointer"
            : "border-cream/10 bg-cream/5 cursor-not-allowed opacity-40"
        )}
      >
        <div className="flex items-center gap-2">
          <Badge
            variant={pick ? 'success' : isSelected ? 'default' : 'secondary'}
            className="w-10 justify-center"
          >
            {slot.label}
          </Badge>
          {pick ? (
            <div className="flex-1 min-w-0">
              <div className="font-display font-semibold text-cream truncate">
                {pick.playerName}
              </div>
              <div className="text-xs text-cream/60 font-mono">
                {pick.year} · {pick.team}
              </div>
            </div>
          ) : (
            <div className="flex-1 text-cream/40 font-body text-sm">
              {isAvailable ? 'Click to fill' : 'Empty'}
            </div>
          )}
        </div>
      </button>
    );
  };

  const filledCount = picks.length;
  const totalSlots = ROSTER_CONFIG.length;

  return (
    <div className="bg-navy-light/50 backdrop-blur-sm border border-cream/10 rounded-xl p-4 space-y-6">
      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-cream">Your Roster</h2>
        <div className="flex items-center gap-2">
          <div className="text-sm font-mono text-gold">
            {filledCount}/{totalSlots}
          </div>
          <div className="w-24 h-2 bg-navy rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-gold to-gold-light transition-all duration-300"
              style={{ width: `${(filledCount / totalSlots) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Batters Section */}
      <div>
        <h3 className="text-sm font-display font-semibold text-cream/60 uppercase tracking-wide mb-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-gold"></span>
          Batters ({BATTER_SLOTS.filter(s => getPickForSlot(s.id)).length}/{BATTER_SLOTS.length})
        </h3>
        <div className="space-y-2">
          {BATTER_SLOTS.map(renderSlot)}
        </div>
      </div>

      {/* Pitchers Section */}
      <div>
        <h3 className="text-sm font-display font-semibold text-cream/60 uppercase tracking-wide mb-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-grass"></span>
          Pitchers ({PITCHER_SLOTS.filter(s => getPickForSlot(s.id)).length}/{PITCHER_SLOTS.length})
        </h3>
        <div className="space-y-2">
          {PITCHER_SLOTS.map(renderSlot)}
        </div>
      </div>
    </div>
  );
}
