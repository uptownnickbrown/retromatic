import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { POSITIONS } from '../../types';
import type { ResultsPick } from '../../types';
import { safeNum } from '../../lib/numeric';
import { PlayerPortrait } from '../game/PlayerPortrait';
import { zToPercentile, getDisplayStats } from '../../lib/statBenchmark';
import { renderBlurb } from '../../lib/renderBlurb';

interface FinalLineupProps {
  picks: ResultsPick[];
}

export function FinalLineup({ picks }: FinalLineupProps) {
  const sortedPicks = [...picks].sort(
    (a, b) => POSITIONS.indexOf(a.position as typeof POSITIONS[number]) - POSITIONS.indexOf(b.position as typeof POSITIONS[number])
  );

  // Pre-expand the best pick so users discover the expand interaction
  const [expandedIndex, setExpandedIndex] = useState<number | null>(() => {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < sortedPicks.length; i++) {
      const s = safeNum(sortedPicks[i].legendScore);
      if (s > bestScore) { bestScore = s; bestIdx = i; }
    }
    return sortedPicks[bestIdx]?.categoryZscores ? bestIdx : null;
  });

  return (
    <div className="paper-card py-5 px-3 space-y-0.5">
      <h3 className="font-editorial text-sm font-bold uppercase tracking-wider text-navy mb-3 text-center">
        Lineup Card
      </h3>
      <div className="ink-divider mb-3" />
      {sortedPicks.map((pick, i) => {
        const score = safeNum(pick.legendScore);
        const isSandlotLegend = score >= 9.5;
        const isExpanded = expandedIndex === i;

        return (
          <div key={i}>
            <motion.button
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => setExpandedIndex(isExpanded ? null : i)}
              className={cn(
                'w-full flex items-center gap-2.5 py-2.5 px-1.5 text-left',
                'transition-colors rounded',
                isSandlotLegend ? 'bg-gold/8 hover:bg-gold/12' : 'hover:bg-navy/3',
                pick.wasTimeout && 'opacity-40',
              )}
            >
              <PlayerPortrait
                name={pick.playerName}
                portraitUrl={pick.portraitUrl ?? null}
                position={pick.position}
                size="md"
                className="flex-shrink-0"
              />
              <span className={cn(
                'font-mono text-xs font-bold w-8 text-center flex-shrink-0',
                isSandlotLegend ? 'text-gold' : 'text-muted',
              )}>
                {pick.position}
              </span>
              <span className={cn(
                'flex-1 truncate',
                pick.wasTimeout
                  ? 'font-mono text-sm text-muted line-through'
                  : 'font-editorial italic text-navy text-base',
              )}>
                {pick.playerName}
                {pick.wasTimeout && ' (auto)'}
              </span>
              <span className={cn(
                'font-mono text-sm flex-shrink-0',
                isSandlotLegend ? 'text-gold/70' : 'text-muted',
              )}>
                {pick.year}
              </span>
              <span className={cn(
                'font-mono text-sm font-bold min-w-[36px] text-right flex-shrink-0',
                isSandlotLegend ? 'text-gold' : score >= 6.0 ? 'text-navy' : 'text-muted',
              )}>
                {score.toFixed(1)}
              </span>
            </motion.button>

            {/* Expanded detail */}
            <AnimatePresence>
              {isExpanded && pick.categoryZscores && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <ExpandedPickStats pick={pick} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function ExpandedPickStats({ pick }: { pick: ResultsPick }) {
  const playerType = pick.playerType ?? 'batter';
  const statConfigs = getDisplayStats(playerType);
  const categoryZscores = pick.categoryZscores ?? {};

  return (
    <div className="bg-bone/50 px-2 pb-3 pt-1 ml-[4.5rem]">
      {/* Stats grid with percentile bars */}
      <div className="border border-navy/10 rounded overflow-hidden mb-2">
        <div className="grid grid-cols-5 divide-x divide-navy/10 bg-paper">
          {statConfigs.map((cfg) => {
            const rawValue = pick.stats[cfg.statKey] ?? pick.stats[cfg.statKey.toLowerCase()];
            const zScore = categoryZscores[cfg.key] ?? categoryZscores[cfg.key.toLowerCase()];
            const percentile = cfg.hasPercentile && zScore !== undefined ? zToPercentile(zScore) : null;
            return (
              <div key={cfg.key} className="flex flex-col items-center gap-0.5 py-2 px-1">
                <span className="text-[9px] uppercase tracking-wider text-muted font-mono leading-none">
                  {cfg.label}
                </span>
                <span className="font-mono font-bold text-base text-navy leading-none mt-0.5">
                  {rawValue !== undefined ? cfg.format(rawValue) : '--'}
                </span>
                {percentile !== null && (
                  <div className="w-full mt-1">
                    <div className="h-1 bg-navy/10 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-navy"
                        style={{ width: `${percentile}%` }}
                      />
                    </div>
                    <span className="text-[8px] font-mono text-muted block text-center mt-0.5 tabular-nums">
                      {percentile}%
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Blurb */}
      {pick.blurb && (
        <div className="bg-bone rounded p-3 border border-navy/10">
          <p className="font-mono text-[13px] leading-relaxed text-left text-navy/80 tracking-tight">
            {renderBlurb(pick.blurb)}
          </p>
        </div>
      )}
    </div>
  );
}
