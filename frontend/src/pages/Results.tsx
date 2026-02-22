import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, ArrowLeft, FlaskConical } from 'lucide-react';
import { useChallengeResults } from '../hooks/useChallenge';
import { getOrdinalSuffix } from '../lib/utils';
import { safeNum } from '../lib/numeric';
import { SandlotScoreBadge } from '../components/game/SandlotScoreBadge';
import { FinalLineup } from '../components/results/FinalLineup';
import { HeadToHead } from '../components/results/HeadToHead';
import { RotoComparison } from '../components/results/RotoComparison';
import { ShareCard } from '../components/results/ShareCard';
import { PaperCard } from '../components/ui/PaperCard';
import { VintageButton } from '../components/ui/VintageButton';
import type { ResultsData } from '../types';

export function Results() {
  const { challengeId } = useParams<{ challengeId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const isPlaytest = searchParams.get('playtest') === 'true';
  const playtestResults = (location.state as { playtestResults?: ResultsData } | null)?.playtestResults ?? null;
  const playtestChallengeId = (location.state as { challengeId?: number } | null)?.challengeId ?? null;

  // For playtest: use router state directly; for normal: fetch from API
  const { data: apiData, isLoading, error } = useChallengeResults(
    isPlaytest ? null : (challengeId ? parseInt(challengeId) : null),
  );

  const data = isPlaytest ? playtestResults : apiData;

  if (!isPlaytest && isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-navy border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-muted text-sm font-mono mb-4">
          {error ? (error as Error).message : 'Results not found'}
        </p>
        <VintageButton variant="section" onClick={() => navigate(isPlaytest ? '/admin' : '/')}>
          {isPlaytest ? 'Back to Admin' : 'Back Home'}
        </VintageButton>
      </div>
    );
  }

  const { session, picks, perfectLineup, totalParticipants } = data;
  const totalScore = safeNum(session.totalLegendScore);
  const percentile = safeNum(session.percentile, 50);
  const percentileRank = Math.max(1, 100 - Math.round(percentile));

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-3 py-4 safe-bottom">
      {/* Playtest banner */}
      {isPlaytest && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-gold/15 border-2 border-gold/30 rounded px-4 py-2.5 mb-4 flex items-center justify-center gap-2"
        >
          <FlaskConical className="w-3.5 h-3.5 text-gold" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-navy/70">
            Playtest Results
          </span>
        </motion.div>
      )}

      {/* Home icon — only for non-playtest */}
      {!isPlaytest && (
        <button
          onClick={() => navigate('/')}
          className="self-start mb-3 p-2 -ml-1 text-navy/50 hover:text-navy transition-colors"
          aria-label="Home"
        >
          <Home size={20} />
        </button>
      )}

      {/* Compact header — score + badge + percentile */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="mb-4"
      >
        <PaperCard noPadding>
          <div className="flex items-center gap-4 px-4 py-3">
            <div className="flex-1">
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted mb-1">
                Sandlot Score
              </p>
              <p className="font-editorial font-bold text-3xl text-navy leading-none">
                {totalScore.toFixed(1)}
                <span className="text-sm text-muted font-mono">/100</span>
              </p>
            </div>
            <SandlotScoreBadge score={totalScore / 10} size="md" animate showLabel />
          </div>
          {/* Percentile slab — hide for playtest */}
          {!isPlaytest && (
            <div className="bg-[#ECE9E0] px-4 py-2.5 rounded-b">
              <p className="text-sm font-mono text-navy text-center">
                <span className="font-editorial font-bold text-lg">
                  {getOrdinalSuffix(percentileRank)}
                </span>{' '}
                percentile — {totalParticipants} player{totalParticipants !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </PaperCard>
      </motion.div>

      {/* Share — hide for playtest */}
      {!isPlaytest && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mb-4"
        >
          <ShareCard
            totalScore={totalScore}
            percentile={percentile}
            picks={picks}
            date={session.completedAt?.split('T')[0] ?? ''}
          />
        </motion.div>
      )}

      {/* Your lineup — interactive mini-cards */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: isPlaytest ? 0.2 : 0.3 }}
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
        transition={{ delay: isPlaytest ? 0.3 : 0.4 }}
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

      {/* Roto: Season-Long Head to Head */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: isPlaytest ? 0.4 : 0.5 }}
        className="mb-4"
      >
        <h3 className="font-editorial font-bold text-navy text-sm uppercase tracking-wider mb-3">
          Roto Matchup
        </h3>
        <RotoComparison
          leftPicks={picks}
          rightPicks={perfectLineup.picks}
        />
      </motion.div>

      {/* Navigation — playtest gets back button */}
      {isPlaytest && (
        <div className="flex gap-3 mt-auto pt-4">
          <VintageButton
            variant="section"
            onClick={() => navigate(`/admin/challenge/${playtestChallengeId ?? challengeId}?playtested=true`)}
            className="flex-1 flex items-center justify-center gap-2"
          >
            <ArrowLeft size={16} />
            Back to Challenge
          </VintageButton>
        </div>
      )}
    </div>
  );
}
