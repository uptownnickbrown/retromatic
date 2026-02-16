import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import type { ResultsPick } from '../../types';
import { getLegendScoreTier } from '../../types';
import { safeNum } from '../../lib/numeric';
import { PlayerPortrait } from '../game/PlayerPortrait';

interface FinalLineupProps {
  picks: ResultsPick[];
}

export function FinalLineup({ picks }: FinalLineupProps) {
  return (
    <div className="space-y-2 w-full">
      {picks.map((pick, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.06 }}
          className={cn(
            'card flex items-center gap-3 px-3 py-2.5',
            pick.wasTimeout && 'opacity-50',
          )}
        >
          <span className="text-[10px] font-heading text-field-dark/40 w-7 text-center">
            {pick.position}
          </span>
          <PlayerPortrait
            name={pick.playerName}
            portraitUrl={null}
            position={pick.position}
            size="sm"
          />
          <div className="flex-1 min-w-0 relative z-10">
            <p className="text-sm font-heading text-field-dark truncate">{pick.playerName}</p>
            <p className="text-xs text-field-dark/50 font-body">
              {pick.year} &middot; {pick.team}
              {pick.wasTimeout && ' (auto)'}
            </p>
          </div>
          <div
            className={cn(
              'px-2 py-1 rounded text-xs font-score font-bold text-white relative z-10',
              getLegendScoreTier(safeNum(pick.legendScore)),
            )}
            style={{
              background: 'var(--ls-bg)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }}
          >
            {safeNum(pick.legendScore).toFixed(1)}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
