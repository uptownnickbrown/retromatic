import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { getLegendScoreLabel, getLegendScoreTier } from '../../types';
import { safeNum } from '../../lib/numeric';
import { WaxSeal } from '../ui/WaxSeal';

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
  const isLegendary = score >= 9.5;
  const isGreat = score >= 6.0 && !isLegendary;

  // Legendary: wax seal
  if (isLegendary) {
    return (
      <div className={cn('flex flex-col items-center gap-1.5', tier)}>
        <WaxSeal score={score} size={size} animate={animate} />
        {showLabel && (
          <span className="font-editorial text-xs uppercase tracking-widest text-gold font-bold">
            {label}
          </span>
        )}
      </div>
    );
  }

  // Great: navy circle badge
  if (isGreat) {
    const sizeClasses = {
      sm: 'w-10 h-10 text-xs',
      md: 'w-14 h-14 text-lg',
      lg: 'w-20 h-20 text-2xl',
    };

    const content = (
      <div className={cn('flex flex-col items-center gap-1.5', tier)}>
        <div
          className={cn(
            'rounded-full flex items-center justify-center font-editorial font-bold text-paper bg-navy',
            'border-2 border-navy shadow-[2px_2px_0px_rgba(10,30,47,0.15)]',
            sizeClasses[size],
          )}
          style={{ boxShadow: 'inset 0 0 0 2px #F9F7F1, 2px 2px 0px rgba(10,30,47,0.15)' }}
        >
          {score.toFixed(1)}
        </div>
        {showLabel && (
          <span className="font-mono text-[10px] uppercase tracking-widest text-navy">
            {label}
          </span>
        )}
      </div>
    );

    if (animate) {
      return (
        <motion.div
          initial={{ scale: 0, rotate: -90 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 14 }}
        >
          {content}
        </motion.div>
      );
    }

    return content;
  }

  // Average: light circle badge (paper fill, thin navy border)
  const avgSizeClasses = {
    sm: 'w-10 h-10 text-xs',
    md: 'w-14 h-14 text-lg',
    lg: 'w-20 h-20 text-2xl',
  };

  const content = (
    <div className={cn('flex flex-col items-center gap-1.5', tier)}>
      <div
        className={cn(
          'rounded-full flex items-center justify-center font-editorial font-bold text-muted',
          'bg-paper border border-navy/20',
          avgSizeClasses[size],
        )}
      >
        {score.toFixed(1)}
      </div>
      {showLabel && (
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
          {label}
        </span>
      )}
    </div>
  );

  if (animate) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {content}
      </motion.div>
    );
  }

  return content;
}
