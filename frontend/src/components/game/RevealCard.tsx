import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import type { RevealData } from '../../types';
import { LegendScoreBadge } from './LegendScoreBadge';

interface RevealCardProps {
  reveal: RevealData;
  onContinue: () => void;
  isLastRound: boolean;
}

export function RevealCard({ reveal, onContinue, isLastRound }: RevealCardProps) {
  useEffect(() => {
    const timer = setTimeout(onContinue, 6000);
    return () => clearTimeout(timer);
  }, [onContinue]);

  const maxPct = Math.max(...reveal.pickPercentages.map(p => p.percentage), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full px-3"
    >
      <div className="premium-card rounded-2xl p-5 text-center">
        {/* Score reveal */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.2 }}
          className="mb-4"
        >
          <LegendScoreBadge score={reveal.legendScore} size="lg" animate showLabel />
        </motion.div>

        {/* Player info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mb-3"
        >
          <h3 className="font-display text-xl text-cream font-bold">
            {reveal.playerName}
          </h3>
          <p className="text-sm text-cream/60 font-mono">
            {reveal.year} &middot; {reveal.team}
          </p>
        </motion.div>

        {/* Blurb */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-sm text-cream/80 italic mb-4 leading-relaxed"
        >
          "{reveal.blurb}"
        </motion.p>

        {/* Community picks */}
        {reveal.pickPercentages.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1 }}
            className="space-y-1.5 mb-4"
          >
            <p className="text-[10px] uppercase tracking-widest text-cream/40 font-bold mb-2">
              Community Picks
            </p>
            {reveal.pickPercentages.map(pp => (
              <div key={`${pp.playerId}-${pp.year}`} className="flex items-center gap-2">
                <div className="flex-1 h-5 bg-navy-light/60 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(pp.percentage / maxPct) * 100}%` }}
                    transition={{ delay: 1.3, duration: 0.6 }}
                    className={cn(
                      'h-full rounded-full',
                      pp.year === reveal.year ? 'bg-gold' : 'bg-cream/20',
                    )}
                  />
                </div>
                <span className="text-xs font-mono text-cream/60 w-10 text-right">
                  {pp.percentage}%
                </span>
              </div>
            ))}
          </motion.div>
        )}

        {/* Continue button */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          onClick={onContinue}
          className={cn(
            'w-full py-3 rounded-xl font-bold text-sm transition-all min-h-[44px]',
            isLastRound
              ? 'bg-gold text-navy hover:bg-gold-light'
              : 'bg-cream/10 text-cream hover:bg-cream/20',
          )}
        >
          {isLastRound ? 'See Results' : 'Next Round'}
        </motion.button>
      </div>
    </motion.div>
  );
}
