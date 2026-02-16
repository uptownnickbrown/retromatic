import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { getLegendScoreColor, getLegendScoreBg, getLegendScoreLabel } from '../../types';

interface LegendScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
  showLabel?: boolean;
}

export function LegendScoreBadge({ score, size = 'md', animate = false, showLabel = false }: LegendScoreBadgeProps) {
  const colorClass = getLegendScoreColor(score);
  const bgClass = getLegendScoreBg(score);
  const label = getLegendScoreLabel(score);
  const isLegendary = score >= 9.0;

  const sizeClasses = {
    sm: 'w-10 h-10 text-sm',
    md: 'w-14 h-14 text-lg',
    lg: 'w-20 h-20 text-2xl',
  };

  if (animate) {
    return (
      <div className="flex flex-col items-center gap-1">
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring' as const, stiffness: 200, damping: 15 }}
          className={cn(
            'rounded-full border-2 flex items-center justify-center font-mono font-bold',
            bgClass, colorClass, sizeClasses[size],
            isLegendary && 'pulse-glow',
          )}
        >
          {score.toFixed(1)}
        </motion.div>
        {showLabel && (
          <span className={cn('text-xs font-bold uppercase tracking-wider', colorClass)}>
            {label}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          'rounded-full border-2 flex items-center justify-center font-mono font-bold',
          bgClass, colorClass, sizeClasses[size],
          isLegendary && 'pulse-glow',
        )}
      >
        {score.toFixed(1)}
      </div>
      {showLabel && (
        <span className={cn('text-xs font-bold uppercase tracking-wider', colorClass)}>
          {label}
        </span>
      )}
    </div>
  );
}
