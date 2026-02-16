import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import type { PickSummary } from '../../types';
import { getLegendScoreTier } from '../../types';
import { safeNum } from '../../lib/numeric';

interface RosterStripProps {
  totalRounds: number;
  currentRound: number;
  picks: PickSummary[];
  positions: string[];
}

export function RosterStrip({ totalRounds, currentRound, picks, positions }: RosterStripProps) {
  return (
    <div className="flex items-end justify-center gap-1 py-1">
      {Array.from({ length: totalRounds }, (_, i) => {
        const roundNum = i + 1;
        const pick = picks.find(p => p.roundNumber === roundNum);
        const isCurrent = roundNum === currentRound;
        const position = positions[i] || '';

        return (
          <div key={i} className="flex flex-col items-center gap-0.5" style={{ minWidth: 28 }}>
            {pick ? (
              <motion.div
                initial={{ scale: 0, rotateX: -90 }}
                animate={{ scale: 1, rotateX: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                className={cn(
                  'w-7 h-7 rounded flex items-center justify-center text-[10px] font-score font-bold text-white',
                  getLegendScoreTier(safeNum(pick.legendScore)),
                )}
                style={{
                  background: 'var(--ls-bg)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                }}
              >
                {safeNum(pick.legendScore).toFixed(1)}
              </motion.div>
            ) : isCurrent ? (
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 1.2 }}
                className="w-7 h-7 rounded border-2 border-amber flex items-center justify-center"
                style={{
                  background: 'rgba(255, 149, 0, 0.15)',
                  boxShadow: '0 0 8px rgba(255, 149, 0, 0.3)',
                }}
              >
                <div className="w-2 h-2 rounded-sm bg-amber" />
              </motion.div>
            ) : (
              <div
                className="w-7 h-7 rounded border border-white/15"
                style={{ background: 'rgba(0,0,0,0.2)' }}
              />
            )}
            <span className={cn(
              'text-[7px] font-heading tracking-wide',
              isCurrent ? 'text-amber' : pick ? 'text-cardboard/60' : 'text-white/25',
            )}>
              {position}
            </span>
          </div>
        );
      })}
    </div>
  );
}
