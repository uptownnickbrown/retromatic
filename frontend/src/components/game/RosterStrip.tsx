import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import type { PickSummary } from '../../types';
import { getLegendScoreColor } from '../../types';

interface RosterStripProps {
  totalRounds: number;
  currentRound: number;
  picks: PickSummary[];
  positions: string[];
}

export function RosterStrip({ totalRounds, currentRound, picks, positions }: RosterStripProps) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-2">
      {Array.from({ length: totalRounds }, (_, i) => {
        const roundNum = i + 1;
        const pick = picks.find(p => p.roundNumber === roundNum);
        const isCurrent = roundNum === currentRound;
        const position = positions[i] || '';

        return (
          <div key={i} className="flex flex-col items-center gap-0.5">
            {pick ? (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-mono font-bold border',
                  pick.legendScore >= 9 ? 'bg-yellow-400/20 border-yellow-400 text-yellow-400' :
                  pick.legendScore >= 7 ? 'bg-emerald-400/20 border-emerald-400 text-emerald-400' :
                  pick.legendScore >= 5 ? 'bg-slate-300/20 border-slate-300 text-slate-300' :
                  'bg-amber-500/20 border-amber-500 text-amber-500',
                )}
              >
                {pick.legendScore.toFixed(1)}
              </motion.div>
            ) : isCurrent ? (
              <motion.div
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="w-7 h-7 rounded-full border-2 border-gold bg-gold/20 flex items-center justify-center"
              >
                <div className="w-2 h-2 rounded-full bg-gold" />
              </motion.div>
            ) : (
              <div className="w-7 h-7 rounded-full border border-cream/20" />
            )}
            <span className={cn(
              'text-[8px] font-bold',
              isCurrent ? 'text-gold' : pick ? getLegendScoreColor(pick.legendScore) : 'text-cream/30',
            )}>
              {position}
            </span>
          </div>
        );
      })}
    </div>
  );
}
