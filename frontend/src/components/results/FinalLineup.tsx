import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import type { ResultsPick } from '../../types';
import { getLegendScoreColor, getLegendScoreBg } from '../../types';
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
          transition={{ delay: i * 0.08 }}
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-xl',
            'bg-white/5 border border-white/5',
            pick.wasTimeout && 'opacity-60',
          )}
        >
          <span className="text-[10px] font-bold text-cream/40 w-6 text-center font-mono">
            {pick.position}
          </span>
          <PlayerPortrait
            name={pick.playerName}
            portraitUrl={null}
            position={pick.position}
            size="sm"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-cream truncate">{pick.playerName}</p>
            <p className="text-xs text-cream/50 font-mono">
              {pick.year} &middot; {pick.team}
              {pick.wasTimeout && ' (auto)'}
            </p>
          </div>
          <div className={cn(
            'px-2 py-1 rounded-lg text-xs font-mono font-bold border',
            getLegendScoreBg(pick.legendScore),
            getLegendScoreColor(pick.legendScore),
          )}>
            {pick.legendScore.toFixed(1)}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
