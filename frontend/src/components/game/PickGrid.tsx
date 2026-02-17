import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null);

  const handleCardTap = (slot: number) => {
    if (disabled) return;
    setFocusedSlot(prev => prev === slot ? null : slot);
  };

  const handleYearPick = (player: PlayerOption, year: number) => {
    if (disabled) return;
    const yearOption = player.yearOptions.find(y => y.year === year);
    if (!yearOption) return;
    onPick(yearOption.playerRecordId, year);
  };

  return (
    <div className="flex gap-2 w-full px-2 items-start">
      {players.map((player, i) => {
        const isFocused = focusedSlot === player.slot;
        const hasAnyFocused = focusedSlot !== null;
        const isDimmed = hasAnyFocused && !isFocused;

        return (
          <motion.div
            key={player.slot}
            initial={{ opacity: 0, y: 20 }}
            animate={{
              opacity: isDimmed ? 0.4 : 1,
              y: 0,
              flex: isFocused ? 3 : hasAnyFocused ? 1 : 1,
            }}
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 25,
              delay: hasAnyFocused ? 0 : i * 0.1,
            }}
            className={cn(
              'paper-card cursor-pointer overflow-hidden min-w-0',
              'transition-shadow duration-200',
              isFocused && 'shadow-[3px_3px_0px_rgba(10,30,47,0.2)]',
              disabled && 'opacity-50 pointer-events-none',
            )}
            onClick={() => handleCardTap(player.slot)}
          >
            <div className="p-2 flex flex-col items-center">
              {/* Portrait */}
              <PlayerPortrait
                name={player.name}
                portraitUrl={player.portraitUrl}
                position={position}
                size={isFocused ? 'lg' : 'md'}
                className="mb-2"
              />

              {/* Player name */}
              <h3 className={cn(
                'font-editorial font-bold text-navy text-center leading-tight truncate w-full',
                isFocused ? 'text-sm' : 'text-[11px]',
              )}>
                {player.name}
              </h3>

              {/* Position tag — only when focused */}
              {isFocused && (
                <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-muted mt-0.5">
                  {position}
                </span>
              )}
            </div>

            {/* Year tabs — only when focused */}
            <AnimatePresence>
              {isFocused && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="ink-divider mx-2" />
                  <div className="flex flex-col gap-1.5 p-2">
                    {player.yearOptions.map((yo, yi) => (
                      <motion.button
                        key={yo.year}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1 + yi * 0.06 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleYearPick(player, yo.year);
                        }}
                        disabled={disabled}
                        className="year-tab text-xs w-full"
                      >
                        <span className="font-mono font-bold">{yo.year}</span>
                        <span className="text-muted ml-1.5 text-[10px]">{yo.team}</span>
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}
