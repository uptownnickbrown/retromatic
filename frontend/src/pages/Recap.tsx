import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home } from 'lucide-react';
import { useRecap } from '../hooks/useChallenge';
import { safeNum } from '../lib/numeric';
import { HeadToHead } from '../components/results/HeadToHead';
import { RotoComparison } from '../components/results/RotoComparison';
import { PaperCard } from '../components/ui/PaperCard';
import { VintageButton } from '../components/ui/VintageButton';

export function Recap() {
  const { challengeId } = useParams<{ challengeId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error } = useRecap(
    challengeId ? parseInt(challengeId) : null,
  );

  if (isLoading) {
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
          {error ? (error as Error).message : 'Recap not available'}
        </p>
        <VintageButton variant="section" onClick={() => navigate('/')}>
          Back Home
        </VintageButton>
      </div>
    );
  }

  const { challenge, communityLineup, perfectLineup, totalParticipants } = data;
  const communityTotal = safeNum(communityLineup.totalScore);
  const perfectTotal = safeNum(perfectLineup.totalScore);

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-3 py-4 safe-bottom">
      {/* Home icon */}
      <button
        onClick={() => navigate('/')}
        className="self-start mb-3 p-2 -ml-1 text-navy/50 hover:text-navy transition-colors"
        aria-label="Home"
      >
        <Home size={20} />
      </button>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4"
      >
        <PaperCard noPadding>
          <div className="px-4 py-3 text-center">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-muted mb-1">
              Community Recap
            </p>
            {challenge.theme && (
              <p className="font-editorial italic text-navy text-lg leading-tight">
                "{challenge.theme}"
              </p>
            )}
            <p className="font-mono text-[10px] text-muted mt-1">
              {challenge.date} · {totalParticipants} player{totalParticipants !== 1 ? 's' : ''}
            </p>
          </div>
        </PaperCard>
      </motion.div>

      {/* Head-to-Head: Community vs Perfect */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="mb-4"
      >
        <h3 className="font-editorial font-bold text-navy text-sm uppercase tracking-wider mb-3">
          Tale of the Tape
        </h3>
        <HeadToHead
          picks={communityLineup.picks}
          perfectPicks={perfectLineup.picks}
          yourTotal={communityTotal}
          perfectTotal={perfectTotal}
          leftLabel="Community"
          rightLabel="Perfect"
        />
      </motion.div>

      {/* Roto Matchup */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="mb-4"
      >
        <h3 className="font-editorial font-bold text-navy text-sm uppercase tracking-wider mb-3">
          Roto Matchup
        </h3>
        <RotoComparison
          leftPicks={communityLineup.picks}
          rightPicks={perfectLineup.picks}
          leftLabel="Community"
          rightLabel="Perfect"
        />
      </motion.div>

      {/* Back Home */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="mt-auto pt-4"
      >
        <VintageButton
          variant="section"
          onClick={() => navigate('/')}
          className="w-full"
        >
          Back Home
        </VintageButton>
      </motion.div>
    </div>
  );
}
