import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, Trophy, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useChallengeResults } from '../hooks/useChallenge';
import { cn } from '../lib/utils';
import { getOrdinalSuffix } from '../lib/utils';
import { LegendScoreBadge } from '../components/game/LegendScoreBadge';
import { FinalLineup } from '../components/results/FinalLineup';
import { ShareCard } from '../components/results/ShareCard';
import { getLegendScoreColor } from '../types';

export function Results() {
  const { challengeId } = useParams<{ challengeId: string }>();
  const navigate = useNavigate();
  const [showPerfect, setShowPerfect] = useState(false);
  const { data, isLoading, error } = useChallengeResults(
    challengeId ? parseInt(challengeId) : null,
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-cream/60 text-sm mb-4">
          {error ? (error as Error).message : 'Results not found'}
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-3 rounded-xl bg-cream/10 text-cream font-bold text-sm min-h-[44px]"
        >
          Back Home
        </button>
      </div>
    );
  }

  const { session, picks, perfectLineup, totalParticipants } = data;
  const percentileRank = Math.max(1, 100 - Math.round(session.percentile));

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-5 py-6 safe-bottom">
      {/* Header score */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-6"
      >
        <p className="text-xs text-cream/40 uppercase tracking-wider font-bold mb-3">
          Final Legend Score
        </p>
        <LegendScoreBadge score={session.totalLegendScore} size="lg" animate showLabel />
        <p className="text-3xl font-mono font-black text-cream mt-3">
          {session.totalLegendScore.toFixed(1)}
          <span className="text-base text-cream/40">/100</span>
        </p>
      </motion.div>

      {/* Percentile */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className="premium-card rounded-2xl p-4 text-center mb-5"
      >
        <p className="text-sm text-cream/80">
          You placed{' '}
          <span className="font-bold text-gold font-mono text-lg">
            {getOrdinalSuffix(percentileRank)}
          </span>{' '}
          percentile
        </p>
        <p className="text-xs text-cream/40 mt-1">
          out of {totalParticipants} player{totalParticipants !== 1 ? 's' : ''}
        </p>
      </motion.div>

      {/* Share */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mb-5"
      >
        <ShareCard
          totalScore={session.totalLegendScore}
          percentile={session.percentile}
          picks={picks}
          date={session.completedAt.split('T')[0]}
        />
      </motion.div>

      {/* Your lineup */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="mb-5"
      >
        <h3 className="font-display text-lg text-cream font-bold mb-3">Your Lineup</h3>
        <FinalLineup picks={picks} />
      </motion.div>

      {/* Perfect lineup comparison */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mb-5"
      >
        <button
          onClick={() => setShowPerfect(!showPerfect)}
          className="flex items-center gap-2 text-sm text-cream/60 hover:text-cream transition-colors mb-3"
        >
          <span className="font-display font-bold">Perfect Lineup</span>
          <span className="font-mono text-gold text-xs">
            ({perfectLineup.totalScore.toFixed(1)})
          </span>
          {showPerfect ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showPerfect && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="space-y-1.5"
          >
            {perfectLineup.picks.map((pick, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5"
              >
                <span className="text-[10px] font-bold text-cream/40 w-6 text-center font-mono">
                  {pick.position}
                </span>
                <span className="flex-1 text-sm text-cream/80 truncate">
                  {pick.playerName} ({pick.year})
                </span>
                <span className={cn('font-mono text-xs font-bold', getLegendScoreColor(pick.legendScore))}>
                  {pick.legendScore.toFixed(1)}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </motion.div>

      {/* Navigation */}
      <div className="flex gap-3 mt-auto pt-4">
        <button
          onClick={() => navigate('/')}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-cream/10 text-cream font-bold text-sm hover:bg-cream/20 transition-all min-h-[44px]"
        >
          <Home size={16} />
          Home
        </button>
        <button
          onClick={() => navigate('/leaderboard')}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-cream/10 text-cream font-bold text-sm hover:bg-cream/20 transition-all min-h-[44px]"
        >
          <Trophy size={16} />
          Leaderboard
        </button>
      </div>
    </div>
  );
}
