import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { POSITIONS } from '../../types';
import type { PickSummary } from '../../types';
import { safeNum } from '../../lib/numeric';
import { ChevronDown } from 'lucide-react';

interface LineupCardProps {
  totalRounds: number;
  currentRound: number;
  picks: PickSummary[];
  positions: string[];
  totalScore: number;
}

export function LineupCard({ totalRounds, currentRound, picks, positions, totalScore }: LineupCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="paper-card overflow-hidden">
      {/* Compact header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="font-mono text-xs font-bold uppercase tracking-wider text-navy">
          Round {currentRound}/{totalRounds}
        </span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-muted">
            Score: <span className="font-bold text-navy">{totalScore.toFixed(1)}</span>
          </span>
          <ChevronDown
            size={14}
            className={cn(
              'text-navy/40 transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </div>
      </button>

      {/* Expanded lineup list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2">
              <div className="ink-divider mb-2" />
              <h3 className="font-editorial text-xs font-bold uppercase tracking-wider mb-2 text-navy">
                Today's Lineup
              </h3>
              <div className="space-y-1">
                {POSITIONS.map((pos) => {
                  const pick = picks.find(p => p.position === pos);
                  const currentPosition = positions[currentRound - 1] || '';
                  const isCurrent = pos === currentPosition;
                  const score = pick ? safeNum(pick.legendScore) : 0;

                  return (
                    <div
                      key={pos}
                      className={cn(
                        'flex items-center gap-2 py-0.5 px-1 rounded-sm text-xs',
                        isCurrent && 'bg-gold/10',
                      )}
                    >
                      <span className="font-mono font-bold w-7 text-navy/50 text-[10px]">
                        {pos}
                      </span>
                      {pick ? (
                        <>
                          <span className="font-editorial font-bold flex-1 truncate text-navy text-xs">
                            {pick.playerName}
                          </span>
                          <span className={cn(
                            'font-mono font-bold text-[11px]',
                            score >= 9.5 ? 'text-gold' : score >= 6.0 ? 'text-navy' : 'text-muted',
                          )}>
                            {score.toFixed(1)}
                          </span>
                        </>
                      ) : (
                        <span className="flex-1 border-b border-dashed border-navy/15" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
