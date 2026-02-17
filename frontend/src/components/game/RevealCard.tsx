import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import type { RevealData } from '../../types';
import { getLegendScoreTier } from '../../types';
import { LegendScoreBadge } from './LegendScoreBadge';
import { zToPercentile, getDisplayStats } from '../../lib/statBenchmark';

interface RevealCardProps {
  reveal: RevealData;
  onContinue: () => void;
  isLastRound: boolean;
}

function Confetti() {
  const pieces = useMemo(() =>
    Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      delay: Math.random() * 0.8,
      duration: 2 + Math.random() * 2,
      color: ['#FFD700', '#c41e3a', '#1e4d8c', '#2d6b3f', '#ff9500', '#fff'][Math.floor(Math.random() * 6)],
      size: 4 + Math.random() * 8,
      shape: Math.random() > 0.5 ? 'rounded-full' : 'rounded-sm',
    })),
  []);

  return (
    <>
      {pieces.map(p => (
        <div
          key={p.id}
          className={cn('confetti-piece', p.shape)}
          style={{
            left: p.left,
            backgroundColor: p.color,
            width: p.size,
            height: p.size,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </>
  );
}

function StatBenchmark({ label, value, percentile, inverted, delay }: {
  label: string;
  value: string;
  percentile: number | null;
  inverted?: boolean;
  delay: number;
}) {
  // For inverted stats (ERA, WHIP), a high Z-score means low stat = good
  // The percentile from zToPercentile already handles direction correctly
  const barColor = percentile !== null
    ? percentile >= 90 ? 'bg-yellow-400' :
      percentile >= 75 ? 'bg-emerald-400' :
      percentile >= 50 ? 'bg-blue-400' :
      percentile >= 25 ? 'bg-orange-400' :
      'bg-red-400'
    : 'bg-slate-300';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="flex flex-col items-center gap-1 p-2"
    >
      <span className="font-score text-xl font-bold text-field-dark leading-none">
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-widest text-field-dark/50 font-heading">
        {label}
      </span>
      {percentile !== null && (
        <div className="w-full flex items-center gap-1.5 mt-0.5">
          <div className="flex-1 h-1.5 bg-field-dark/10 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${percentile}%` }}
              transition={{ delay: delay + 0.3, duration: 0.6, ease: 'easeOut' }}
              className={cn('h-full rounded-full', barColor)}
            />
          </div>
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: delay + 0.6 }}
            className="text-[9px] font-score text-field-dark/50 w-8 text-right tabular-nums"
          >
            {percentile}%
          </motion.span>
        </div>
      )}
    </motion.div>
  );
}

export function RevealCard({ reveal, onContinue, isLastRound }: RevealCardProps) {
  const pickPcts = reveal.pickPercentages ?? [];
  const maxPct = Math.max(...pickPcts.map(p => p.percentage), 1);
  const isLegendary = reveal.legendScore >= 9.0;
  const tier = getLegendScoreTier(reveal.legendScore);

  const displayStats = useMemo(() => {
    const configs = getDisplayStats(reveal.playerType);
    return configs.map(cfg => {
      const rawValue = reveal.stats[cfg.statKey] ?? reveal.stats[cfg.statKey.toLowerCase()];
      const zScore = reveal.categoryZscores[cfg.key] ?? reveal.categoryZscores[cfg.key.toLowerCase()];
      let percentile: number | null = null;
      if (cfg.hasPercentile && zScore !== undefined) {
        percentile = cfg.inverted ? zToPercentile(zScore) : zToPercentile(zScore);
      }
      return {
        ...cfg,
        displayValue: rawValue !== undefined ? cfg.format(rawValue) : '--',
        percentile,
      };
    });
  }, [reveal.stats, reveal.categoryZscores, reveal.playerType]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, rotateY: -15 }}
      animate={{ opacity: 1, scale: 1, rotateY: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 18 }}
      className="w-full px-3"
    >
      {isLegendary && <Confetti />}

      <div className={cn('card p-0 overflow-hidden', tier)}>
        {/* Tier-colored banner */}
        <div
          className="text-center text-sm py-2.5 font-heading uppercase tracking-wider"
          style={{
            background: 'var(--ls-bg)',
            color: '#fff',
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
          }}
        >
          {reveal.year} {reveal.team}
        </div>

        <div className="p-4 relative z-10">
          {/* Score reveal */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 12, delay: 0.2 }}
            className="flex justify-center mb-1"
          >
            <LegendScoreBadge score={reveal.legendScore} size="lg" animate showLabel />
          </motion.div>

          {/* Player name */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-center mb-4"
          >
            <h3 className={cn(
              'font-heading text-field-dark text-2xl leading-tight',
              isLegendary && 'gold-shimmer',
            )}>
              {reveal.playerName}
            </h3>
          </motion.div>

          {/* Stat benchmark grid - 2x2 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="grid grid-cols-2 gap-px bg-field-dark/10 rounded-lg overflow-hidden mb-4 border border-field-dark/10"
          >
            {displayStats.map((stat, i) => (
              <div key={stat.key} className="bg-white">
                <StatBenchmark
                  label={stat.label}
                  value={stat.displayValue}
                  percentile={stat.percentile}
                  inverted={stat.inverted}
                  delay={0.7 + i * 0.08}
                />
              </div>
            ))}
          </motion.div>

          {/* Blurb - left-aligned, more space */}
          {reveal.blurb && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.3 }}
              className="bg-field-dark/5 rounded-lg p-3 mb-4 border border-field-dark/10"
            >
              <p className="text-sm text-field-dark/80 font-typewriter leading-relaxed text-left">
                "{reveal.blurb}"
              </p>
            </motion.div>
          )}

          {/* Community picks */}
          {pickPcts.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.8 }}
              className="space-y-1.5 mb-4"
            >
              <p className="text-[10px] uppercase tracking-widest text-field-dark/40 font-heading text-center mb-2">
                Community Picks
              </p>
              {pickPcts.map(pp => (
                <div key={`${pp.playerId}-${pp.year}`} className="flex items-center gap-2">
                  <div className="flex-1 h-4 bg-field-dark/10 rounded overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(pp.percentage / maxPct) * 100}%` }}
                      transition={{ delay: 2.0, duration: 0.6, ease: 'easeOut' }}
                      className={cn(
                        'h-full rounded',
                        pp.year === reveal.year
                          ? 'bg-gradient-to-r from-card-red to-card-red-light'
                          : 'bg-field-dark/20',
                      )}
                    />
                  </div>
                  <span className="text-xs font-score font-bold text-field-dark/60 w-10 text-right">
                    {pp.percentage}%
                  </span>
                </div>
              ))}
            </motion.div>
          )}

          {/* Continue button — user-controlled, no auto-advance */}
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2.0 }}
            onClick={onContinue}
            className={cn(
              'w-full py-3 rounded-lg font-heading text-sm transition-all min-h-[44px]',
              isLastRound
                ? 'card-banner text-base'
                : 'card-banner-blue',
            )}
          >
            {isLastRound ? 'See Results' : 'Next Round'}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
