import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import type { ResultsPick } from '../../types';
import { safeNum } from '../../lib/numeric';
import { WaxSeal } from '../ui/WaxSeal';

interface FinalLineupProps {
  picks: ResultsPick[];
}

export function FinalLineup({ picks }: FinalLineupProps) {
  return (
    <div className="paper-card torn-edge py-6 px-4 space-y-1">
      <h3 className="font-editorial text-xs font-bold uppercase tracking-wider text-navy mb-3 text-center">
        Lineup Card
      </h3>
      <div className="ink-divider mb-3" />
      {picks.map((pick, i) => {
        const score = safeNum(pick.legendScore);
        const isLegendary = score >= 9.5;

        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -15 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className={cn(
              'flex items-center gap-2 py-1.5 px-1',
              pick.wasTimeout && 'opacity-40',
            )}
          >
            <span className="font-mono text-[10px] font-bold text-muted w-7 text-center">
              {pick.position}
            </span>
            <span className={cn(
              'flex-1 text-sm truncate',
              pick.wasTimeout ? 'font-mono text-muted line-through' : 'font-hand text-navy text-base',
            )}>
              {pick.playerName}
              {pick.wasTimeout && ' (auto)'}
            </span>
            <span className="font-mono text-xs text-muted mr-1">
              {pick.year}
            </span>
            {isLegendary ? (
              <WaxSeal score={score} size="sm" />
            ) : (
              <span className={cn(
                'font-mono text-xs font-bold min-w-[32px] text-right',
                score >= 6.0 ? 'text-navy' : 'text-muted',
              )}>
                {score.toFixed(1)}
              </span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
