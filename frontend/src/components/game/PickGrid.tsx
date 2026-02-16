import { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import type { PlayerOption } from '../../types';
import { PlayerPortrait } from './PlayerPortrait';

interface PickGridProps {
  players: PlayerOption[];
  position: string;
  onPick: (playerId: number, year: number) => void;
  disabled?: boolean;
}

export function PickGrid({ players, position, onPick, disabled }: PickGridProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<number | null>(null);

  const handleYearPick = (player: PlayerOption, year: number) => {
    if (disabled) return;
    const yearOption = player.yearOptions.find(y => y.year === year);
    if (!yearOption) return;
    setSelectedPlayer(player.slot);
    onPick(yearOption.playerRecordId, year);
  };

  return (
    <div className="flex flex-col gap-3 w-full px-3">
      {players.map((player, i) => (
        <motion.div
          key={player.slot}
          initial={{ opacity: 0, x: -30, rotateY: -10 }}
          animate={{ opacity: 1, x: 0, rotateY: 0 }}
          transition={{ delay: i * 0.12, type: 'spring', stiffness: 200, damping: 18 }}
          className={cn(
            'card p-3 transition-all',
            selectedPlayer === player.slot && 'ring-3 ring-amber',
            disabled && 'opacity-60 pointer-events-none',
          )}
        >
          {/* Player header row */}
          <div className="flex items-center gap-3 mb-2.5 relative z-10">
            <PlayerPortrait
              name={player.name}
              portraitUrl={player.portraitUrl}
              position={position}
              size="md"
            />
            <div className="flex-1 min-w-0">
              <h3 className="font-heading text-field-dark text-base truncate leading-tight">
                {player.name}
              </h3>
              <span className="card-banner text-[10px] inline-block mt-1 py-0.5 px-2">
                {position}
              </span>
            </div>
          </div>

          {/* Year selection — ticket stub buttons */}
          <div className="flex gap-2 relative z-10">
            {player.yearOptions.map(yo => (
              <button
                key={yo.year}
                onClick={() => handleYearPick(player, yo.year)}
                disabled={disabled}
                className={cn(
                  'ticket-btn flex-1 py-2.5 text-base',
                  'hover:border-card-red hover:bg-card-red/5',
                  'active:translate-y-0.5',
                  'focus-visible:ring-2 focus-visible:ring-amber',
                  'min-h-[44px]',
                )}
              >
                {yo.year}
              </button>
            ))}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
