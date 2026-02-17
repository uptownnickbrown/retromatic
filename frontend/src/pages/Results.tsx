import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, Trophy } from 'lucide-react';
import { useChallengeResults } from '../hooks/useChallenge';
import { getOrdinalSuffix } from '../lib/utils';
import { safeNum } from '../lib/numeric';
import { LegendScoreBadge } from '../components/game/LegendScoreBadge';
import { FinalLineup } from '../components/results/FinalLineup';
import { HeadToHead } from '../components/results/HeadToHead';
import { ShareCard } from '../components/results/ShareCard';
import { PaperCard } from '../components/ui/PaperCard';
import { VintageButton } from '../components/ui/VintageButton';

export function Results() {
  const { challengeId } = useParams<{ challengeId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useChallengeResults(
    challengeId ? parseInt(challengeId) : null,
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-navy border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-muted text-sm font-mono mb-4">
          {error ? (error as Error).message : 'Results not found'}
        </p>
        <VintageButton variant="section" onClick={() => navigate('/')}>
          Back Home
        </VintageButton>
      </div>
    );
  }

  const { session, picks, perfectLineup, totalParticipants } = data;
  const totalScore = safeNum(session.totalLegendScore);
  const percentile = safeNum(session.percentile, 50);
  const percentileRank = Math.max(1, 100 - Math.round(percentile));

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 py-5 safe-bottom">
      {/* Header — Final Score */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="text-center mb-5"
      >
        <h2 className="font-editorial font-bold text-sm uppercase tracking-widest text-muted mb-3">
          Final Score
        </h2>
        <div className="flex justify-center mb-2">
          <LegendScoreBadge score={totalScore} size="lg" animate showLabel />
        </div>
        <p className="font-editorial font-bold text-3xl text-navy mt-2">
          {totalScore.toFixed(1)}
          <span className="text-base text-muted font-mono">/100</span>
        </p>
      </motion.div>

      {/* Percentile */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-4"
      >
        <PaperCard className="text-center">
          <p className="text-sm font-mono text-navy">
            You placed{' '}
            <span className="font-editorial font-bold text-xl">
              {getOrdinalSuffix(percentileRank)}
            </span>{' '}
            percentile
          </p>
          <p className="text-xs text-muted font-mono mt-1">
            out of {totalParticipants} player{totalParticipants !== 1 ? 's' : ''}
          </p>
        </PaperCard>
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
        <h3 className="font-editorial font-bold text-navy text-sm uppercase tracking-wider mb-3">
          Your Lineup
        </h3>
        <FinalLineup picks={picks} />
      </motion.div>

      {/* Head-to-Head: Tale of the Tape */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mb-4"
      >
        <h3 className="font-editorial font-bold text-navy text-sm uppercase tracking-wider mb-3">
          Tale of the Tape
        </h3>
        <HeadToHead
          picks={picks}
          perfectPicks={perfectLineup.picks}
          yourTotal={totalScore}
          perfectTotal={safeNum(perfectLineup.totalScore)}
        />
      </motion.div>

      {/* Navigation */}
      <div className="flex gap-3 mt-auto pt-4">
        <VintageButton
          variant="section"
          onClick={() => navigate('/')}
          className="flex-1 flex items-center justify-center gap-2"
        >
          <Home size={16} />
          Home
        </VintageButton>
        <VintageButton
          variant="section"
          onClick={() => navigate('/leaderboard')}
          className="flex-1 flex items-center justify-center gap-2"
        >
          <Trophy size={16} />
          Standings
        </VintageButton>
      </div>
    </div>
  );
}
