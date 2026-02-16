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
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.1 }}
          className={cn(
            'premium-card rounded-xl p-3 transition-all',
            selectedPlayer === player.slot && 'ring-2 ring-gold',
            disabled && 'opacity-60 pointer-events-none',
          )}
        >
          <div className="flex items-center gap-3 mb-2.5">
            <PlayerPortrait
              name={player.name}
              portraitUrl={player.portraitUrl}
              position={position}
              size="md"
            />
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-cream text-base font-bold truncate">
                {player.name}
              </h3>
              <span className="text-xs text-cream/50 font-mono">{position}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {player.yearOptions.map(yo => (
              <button
                key={yo.year}
                onClick={() => handleYearPick(player, yo.year)}
                disabled={disabled}
                className={cn(
                  'flex-1 py-2.5 rounded-lg font-mono font-bold text-sm',
                  'bg-navy-light/80 text-cream border border-cream/10',
                  'hover:border-gold hover:text-gold hover:bg-gold/10',
                  'active:scale-95 transition-all duration-150',
                  'focus-visible:ring-2 focus-visible:ring-gold',
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
