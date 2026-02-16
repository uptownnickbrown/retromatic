import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, Trophy, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useChallengeResults } from '../hooks/useChallenge';
import { cn, getOrdinalSuffix } from '../lib/utils';
import { safeNum } from '../lib/numeric';
import { getLegendScoreTier } from '../types';
import { LegendScoreBadge } from '../components/game/LegendScoreBadge';
import { FinalLineup } from '../components/results/FinalLineup';
import { ShareCard } from '../components/results/ShareCard';

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
        <div className="w-8 h-8 border-3 border-card-red border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-cardboard/60 text-sm font-body mb-4">
          {error ? (error as Error).message : 'Results not found'}
        </p>
        <button
          onClick={() => navigate('/')}
          className="card-banner-blue px-6 py-3 text-sm min-h-[44px]"
        >
          Back Home
        </button>
      </div>
    );
  }

  const { session, picks, perfectLineup, totalParticipants } = data;
  const totalScore = safeNum(session.totalLegendScore);
  const percentile = safeNum(session.percentile, 50);
  const percentileRank = Math.max(1, 100 - Math.round(percentile));
  const isGreatScore = totalScore >= 70;

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 py-5 safe-bottom">
      {/* Header score — the big reveal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="text-center mb-5"
      >
        <p className="card-banner text-[10px] inline-block mb-3">
          Final Legend Score
        </p>
        <div className="flex justify-center mb-2">
          <LegendScoreBadge score={totalScore} size="lg" animate showLabel />
        </div>
        <p className="font-score text-3xl font-bold text-cardboard mt-2">
          {totalScore.toFixed(1)}
          <span className="text-base text-cardboard/40">/100</span>
        </p>
      </motion.div>

      {/* Percentile rank card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="dirt-card p-4 text-center mb-4"
      >
        <p className="text-sm font-body text-cardboard-light">
          You placed{' '}
          <span className={cn(
            'font-heading text-xl',
            isGreatScore ? 'text-amber-light' : 'text-cardboard',
          )}>
            {getOrdinalSuffix(percentileRank)}
          </span>{' '}
          percentile
        </p>
        <p className="text-xs text-cardboard/40 font-body mt-1">
          out of {totalParticipants} player{totalParticipants !== 1 ? 's' : ''}
        </p>
      </motion.div>

      {/* Share */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mb-4"
      >
        <ShareCard
          totalScore={totalScore}
          percentile={percentile}
          picks={picks}
          date={session.completedAt?.split('T')[0] ?? ''}
        />
      </motion.div>

      {/* Your lineup */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="mb-4"
      >
        <h3 className="font-heading text-cardboard text-lg mb-3">Your Lineup</h3>
        <FinalLineup picks={picks} />
      </motion.div>

      {/* Perfect lineup comparison */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mb-4"
      >
        <button
          onClick={() => setShowPerfect(!showPerfect)}
          className="flex items-center gap-2 text-sm text-cardboard/60 hover:text-cardboard transition-colors mb-3 font-body"
        >
          <span className="font-heading">Perfect Lineup</span>
          <span className="scoreboard text-[10px] px-1.5 py-0.5">
            {safeNum(perfectLineup.totalScore).toFixed(1)}
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
                className="flex items-center gap-3 px-3 py-2 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <span className="text-[10px] font-heading text-cardboard/40 w-6 text-center">
                  {pick.position}
                </span>
                <span className="flex-1 text-sm text-cardboard/80 truncate font-body">
                  {pick.playerName} ({pick.year})
                </span>
                <span
                  className={cn(
                    'font-score text-xs font-bold px-1.5 py-0.5 rounded text-white',
                    getLegendScoreTier(safeNum(pick.legendScore)),
                  )}
                  style={{ background: 'var(--ls-bg)' }}
                >
                  {safeNum(pick.legendScore).toFixed(1)}
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
          className="card-banner-blue flex-1 flex items-center justify-center gap-2 py-3 text-sm min-h-[44px]"
        >
          <Home size={16} />
          Home
        </button>
        <button
          onClick={() => navigate('/leaderboard')}
          className="card-banner-blue flex-1 flex items-center justify-center gap-2 py-3 text-sm min-h-[44px]"
        >
          <Trophy size={16} />
          Leaderboard
        </button>
      </div>
    </div>
  );
}
