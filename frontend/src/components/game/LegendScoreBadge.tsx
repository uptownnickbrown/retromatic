import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { getLegendScoreLabel, getLegendScoreTier } from '../../types';
import { safeNum } from '../../lib/numeric';

interface LegendScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
  showLabel?: boolean;
}

export function LegendScoreBadge({ score: rawScore, size = 'md', animate = false, showLabel = false }: LegendScoreBadgeProps) {
  const score = safeNum(rawScore);
  const label = getLegendScoreLabel(score);
  const tier = getLegendScoreTier(score);
  const isLegendary = score >= 9.0;

  const sizeClasses = {
    sm: 'w-12 h-12 text-sm border-2',
    md: 'w-16 h-16 text-xl border-3',
    lg: 'w-24 h-24 text-3xl border-4',
  };

  const badge = (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={cn(
          'rounded-xl flex items-center justify-center font-score font-bold relative',
          sizeClasses[size],
          tier,
          isLegendary && 'trophy-pulse',
        )}
        style={{
          background: 'var(--ls-bg)',
          color: '#fff',
          borderColor: 'var(--ls-color)',
          textShadow: '0 1px 3px rgba(0,0,0,0.4)',
          boxShadow: isLegendary ? undefined : `0 0 12px var(--ls-glow), inset 0 0 8px rgba(255,255,255,0.15)`,
        }}
      >
        {score.toFixed(1)}
        {isLegendary && (
          <div className="absolute -top-1 -right-1 text-xs">
            {'\u2B50'}
          </div>
        )}
      </div>
      {showLabel && (
        <span
          className={cn(
            'font-display text-xs uppercase tracking-widest',
            size === 'lg' && 'text-sm',
          )}
          style={{ color: 'var(--ls-color)' }}
        >
          {label}
        </span>
      )}
    </div>
  );

  if (animate) {
    return (
      <div className={cn('flex flex-col items-center gap-1.5', tier)}>
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 12 }}
          className={cn(
            'rounded-xl flex items-center justify-center font-score font-bold relative',
            sizeClasses[size],
            isLegendary && 'trophy-pulse',
          )}
          style={{
            background: 'var(--ls-bg)',
            color: '#fff',
            borderColor: 'var(--ls-color)',
            textShadow: '0 1px 3px rgba(0,0,0,0.4)',
            boxShadow: isLegendary ? undefined : `0 0 12px var(--ls-glow), inset 0 0 8px rgba(255,255,255,0.15)`,
          }}
        >
          {score.toFixed(1)}
          {isLegendary && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.5, type: 'spring', stiffness: 300 }}
              className="absolute -top-1.5 -right-1.5 text-sm"
            >
              {'\u2B50'}
            </motion.div>
          )}
        </motion.div>
        {showLabel && (
          <motion.span
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className={cn(
              'font-display text-xs uppercase tracking-widest',
              size === 'lg' && 'text-sm',
              isLegendary && 'gold-shimmer',
            )}
            style={{ color: isLegendary ? undefined : 'var(--ls-color)' }}
          >
            {label}
          </motion.span>
        )}
      </div>
    );
  }

  return badge;
}
