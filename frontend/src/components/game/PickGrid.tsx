import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { getTeamNickname } from '../../lib/teams';
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

  const hasAnyFocused = focusedSlot !== null;

  // Pyramid layout: player 0 on top centered, players 1+2 on bottom row
  const topPlayer = players[0];
  const bottomPlayers = players.slice(1);

  const renderCard = (player: PlayerOption, i: number) => {
    const isFocused = focusedSlot === player.slot;
    const isDimmed = hasAnyFocused && !isFocused;

    return (
      <motion.div
        key={player.slot}
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{
          opacity: isDimmed ? 0.35 : 1,
          y: 0,
        }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 25,
          delay: hasAnyFocused ? 0 : i * 0.1,
        }}
        className={cn(
          'paper-card cursor-pointer overflow-hidden',
          'transition-shadow duration-200',
          isFocused && 'shadow-[4px_4px_0px_#0A1E2F]',
          disabled && 'opacity-50 pointer-events-none',
          isFocused ? 'w-full' : '',
        )}
        onClick={() => handleCardTap(player.slot)}
      >
        <div className={cn('flex flex-col items-center', isFocused ? 'p-4' : 'p-3')}>
          {/* Portrait */}
          <PlayerPortrait
            name={player.name}
            portraitUrl={player.portraitUrl}
            position={position}
            size={isFocused ? '2xl' : 'xl'}
            className="mb-2"
          />

          {/* Player name */}
          <h3 className={cn(
            'font-editorial font-black text-navy text-center leading-tight truncate w-full',
            isFocused ? 'text-xl' : 'text-lg',
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
              <div className="ink-divider mx-3" />
              <div className="flex flex-col gap-1.5 p-3">
                {[...player.yearOptions].sort((a, b) => a.year - b.year).map((yo, yi) => (
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
                    className="year-tab text-sm w-full"
                  >
                    <span className="font-mono font-bold">{yo.year}</span>
                    <span className="text-muted ml-1.5 text-xs">{getTeamNickname(yo.team)}</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  // When a card is focused, show it full-width
  if (hasAnyFocused) {
    const focusedPlayer = players.find(p => p.slot === focusedSlot)!;
    const otherPlayers = players.filter(p => p.slot !== focusedSlot);

    return (
      <div className="flex flex-col gap-2 w-full px-3">
        {renderCard(focusedPlayer, 0)}
        <div className="flex gap-2">
          {otherPlayers.map((p, i) => (
            <div key={p.slot} className="flex-1 min-w-0">
              {renderCard(p, i + 1)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Default pyramid: 1 on top, 2 on bottom — big cards filling the viewport
  return (
    <div className="flex flex-col items-center gap-2 w-full px-3">
      <div className="w-[70%]">
        {renderCard(topPlayer, 0)}
      </div>
      <div className="flex gap-2 w-full">
        {bottomPlayers.map((p, i) => (
          <div key={p.slot} className="flex-1 min-w-0">
            {renderCard(p, i + 1)}
          </div>
        ))}
      </div>
    </div>
  );
}
