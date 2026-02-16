import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import type { RevealData } from '../../types';
import { getLegendScoreTier } from '../../types';
import { LegendScoreBadge } from './LegendScoreBadge';

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

export function RevealCard({ reveal, onContinue, isLastRound }: RevealCardProps) {
  useEffect(() => {
    const timer = setTimeout(onContinue, 6000);
    return () => clearTimeout(timer);
  }, [onContinue]);

  const maxPct = Math.max(...reveal.pickPercentages.map(p => p.percentage), 1);
  const isLegendary = reveal.legendScore >= 9.0;
  const tier = getLegendScoreTier(reveal.legendScore);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, rotateY: -15 }}
      animate={{ opacity: 1, scale: 1, rotateY: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 18 }}
      className="w-full px-3"
    >
      {isLegendary && <Confetti />}

      <div className={cn('card p-0 overflow-hidden', tier)}>
        {/* Card top banner */}
        <div className="card-banner text-center text-sm py-2">
          {reveal.year} {reveal.team}
        </div>

        <div className="p-4 relative z-10">
          {/* Score reveal — the big moment */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 12, delay: 0.2 }}
            className="flex justify-center mb-3"
          >
            <LegendScoreBadge score={reveal.legendScore} size="lg" animate showLabel />
          </motion.div>

          {/* Player name — big and dramatic */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-center mb-3"
          >
            <h3 className={cn(
              'font-heading text-field-dark text-2xl leading-tight',
              isLegendary && 'gold-shimmer',
            )}>
              {reveal.playerName}
            </h3>
          </motion.div>

          {/* Blurb — typewriter style */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="bg-field-dark/5 rounded-lg p-3 mb-3 border border-field-dark/10"
          >
            <p className="text-sm text-field-dark/80 font-typewriter leading-relaxed text-center">
              "{reveal.blurb}"
            </p>
          </motion.div>

          {/* Community picks */}
          {reveal.pickPercentages.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.1 }}
              className="space-y-1.5 mb-3"
            >
              <p className="text-[10px] uppercase tracking-widest text-field-dark/40 font-heading text-center mb-2">
                Community Picks
              </p>
              {reveal.pickPercentages.map(pp => (
                <div key={`${pp.playerId}-${pp.year}`} className="flex items-center gap-2">
                  <div className="flex-1 h-4 bg-field-dark/10 rounded overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(pp.percentage / maxPct) * 100}%` }}
                      transition={{ delay: 1.3, duration: 0.6, ease: 'easeOut' }}
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

          {/* Continue button */}
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.5 }}
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
