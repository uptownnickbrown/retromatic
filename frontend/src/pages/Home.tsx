import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart3, Flame, ChevronRight } from 'lucide-react';
import { useHomeData, useStreak } from '../hooks/useChallenge';
import { SandlotScoreBadge } from '../components/game/SandlotScoreBadge';
import { PaperCard } from '../components/ui/PaperCard';
import { VintageButton } from '../components/ui/VintageButton';
import { safeNum } from '../lib/numeric';

const MILESTONES = [3, 7, 14, 30, 50, 100] as const;
const MILESTONE_TEXT: Record<number, string> = {
  3: 'Hot start!',
  7: 'Full week!',
  14: 'Two weeks strong!',
  30: 'Monthly legend!',
  50: 'Hall of Fame streak!',
  100: 'Hall of Fame streak!',
};
const CELEBRATED_KEY = 'sandlot_last_celebrated_milestone';

function getStreakMilestone(streak: number): number | null {
  for (let i = MILESTONES.length - 1; i >= 0; i--) {
    if (streak >= MILESTONES[i]) return MILESTONES[i];
  }
  return null;
}

function useStreakMilestone(streak: number) {
  // Determine if there's a new milestone to celebrate
  const hit = streak > 0 ? getStreakMilestone(streak) : null;
  const lastCelebrated = parseInt(localStorage.getItem(CELEBRATED_KEY) ?? '0', 10);

  // Use state initializer to claim the milestone exactly once per mount
  const [celebratedMilestone] = useState<number | null>(() => {
    if (hit !== null && hit > lastCelebrated) {
      localStorage.setItem(CELEBRATED_KEY, String(hit));
      return hit;
    }
    return null;
  });

  const [dismissed, setDismissed] = useState(false);

  // Auto-dismiss after 4 seconds — triggered via setTimeout in render (safe since it only fires once)
  const [timerStarted] = useState(() => {
    if (celebratedMilestone !== null) {
      setTimeout(() => setDismissed(true), 4000);
    }
    return true;
  });
  void timerStarted; // suppress unused

  const showCelebration = celebratedMilestone !== null && !dismissed;
  return { showCelebration, milestone: celebratedMilestone };
}

export function Home() {
  const navigate = useNavigate();
  const { data, isLoading } = useHomeData();
  const { data: streakData } = useStreak();

  const today = data?.today;
  const session = data?.session;
  const yesterday = data?.yesterday;
  const tomorrow = data?.tomorrow;
  const isCompleted = session?.status === 'completed';
  const isInProgress = session?.status === 'in_progress';
  const currentStreak = streakData?.current ?? 0;
  const { showCelebration, milestone } = useStreakMilestone(currentStreak);

  return (
    <div className="flex-1 flex flex-col items-center max-w-lg mx-auto w-full px-3 pt-5 pb-20">
      {/* Masthead */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        className="text-center mb-5 w-full"
      >
        <h1 className="font-editorial font-black text-6xl text-navy tracking-tight leading-none">
          SANDLOT
        </h1>
        <div className="ink-divider my-2" />
        <p className="font-mono text-sm text-muted uppercase tracking-[0.2em]">
          Daily Fantasy Baseball Draft
        </p>
      </motion.div>

      {/* Today's Challenge Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 180, damping: 18 }}
        className="w-full mb-4"
      >
        <PaperCard>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-navy border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !today ? (
            <div className="text-center py-6">
              <p className="text-muted text-base font-mono">No challenge today.</p>
              <p className="text-muted/60 text-sm font-mono mt-1">Check back tomorrow!</p>
            </div>
          ) : isCompleted && session ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                    Today's Result
                  </p>
                  {today.theme && (
                    <p className="text-base text-navy font-editorial italic mt-1">"{today.theme}"</p>
                  )}
                </div>
                <SandlotScoreBadge score={safeNum(session.totalLegendScore) / 10} size="md" showLabel />
              </div>

              {session.percentile != null && (
                <div className="bg-bone rounded p-3 mb-4 border border-navy/8">
                  <p className="text-center text-base font-mono text-navy">
                    You scored better than{' '}
                    <span className="font-editorial font-bold text-2xl">
                      {Math.round(safeNum(session.percentile, 50))}%
                    </span>{' '}
                    of players
                  </p>
                </div>
              )}

              <VintageButton
                variant="section"
                onClick={() => navigate(`/results/${today.id}`)}
                className="w-full flex items-center justify-center gap-2"
              >
                <BarChart3 size={16} />
                View Results
              </VintageButton>
            </>
          ) : (
            <>
              <div className="text-center mb-4">
                <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted mb-2">
                  {isInProgress ? 'Game In Progress' : "Today's Challenge"}
                </p>
                {today.theme && (
                  <p className="text-xl text-navy font-editorial italic mt-1">"{today.theme}"</p>
                )}
              </div>

              <VintageButton
                variant="ticket"
                onClick={() => navigate('/play')}
                className="w-full text-xl py-5 tracking-wider"
              >
                {isInProgress ? 'Resume Draft' : 'Play Today'}
              </VintageButton>
            </>
          )}
        </PaperCard>
      </motion.div>

      {/* How to Play — only when game is NOT completed */}
      {!isLoading && today && !isCompleted && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="w-full mb-4"
        >
          <PaperCard>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.15em] text-muted mb-2">
              How to Play
            </p>
            <p className="text-sm text-navy/80 font-mono leading-relaxed">
              10 rounds: 3 players at each position, 3 seasons to pick from. Choose the best fantasy season. Same daily challenge for everyone.
            </p>
            <p className="text-sm text-navy/80 font-mono leading-relaxed mt-2">
              <strong className="text-navy">Sandlot Score</strong> rates each pick's fantasy season impact from 1.0 to 10.0. Hit 9.5+ to unearth a Sandlot Legend.
            </p>
          </PaperCard>
        </motion.div>
      )}

      {/* Yesterday's Recap */}
      {yesterday && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="w-full mb-4"
        >
          <PaperCard>
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs font-bold uppercase tracking-[0.15em] text-muted">
                  Yesterday
                </p>
                {yesterday.theme && (
                  <p className="text-base text-navy font-editorial italic mt-1 truncate">
                    "{yesterday.theme}"
                  </p>
                )}
              </div>
              <button
                onClick={() => navigate(`/recap/${yesterday.id}`)}
                className="flex items-center gap-1 text-sm font-mono text-navy/60 hover:text-navy transition-colors flex-shrink-0 ml-3 py-1"
              >
                Recap
                <ChevronRight size={14} />
              </button>
            </div>
          </PaperCard>
        </motion.div>
      )}

      {/* Tomorrow's Preview */}
      {tomorrow && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
          className="w-full mb-4 text-center"
        >
          <p className="font-mono text-sm text-navy/50">
            Come back tomorrow for{' '}
            {tomorrow.theme ? (
              <span className="font-editorial italic text-base text-navy/70">"{tomorrow.theme}"</span>
            ) : (
              'a new challenge'
            )}
          </p>
        </motion.div>
      )}

      {/* Streak */}
      {currentStreak > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col items-center gap-2"
        >
          {/* Milestone celebration */}
          {showCelebration && milestone && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15 }}
              className="bg-gold/10 border border-gold/30 rounded px-4 py-2 text-center"
            >
              <p className="font-editorial font-bold text-lg text-gold leading-tight">
                {milestone}-day streak!
              </p>
              <p className="font-mono text-sm text-navy/60 mt-0.5">
                {MILESTONE_TEXT[milestone]}
              </p>
            </motion.div>
          )}
          <div className="flex items-center gap-2 text-navy/50">
            <Flame size={18} className={currentStreak >= 7 ? 'text-gold' : 'text-navy/40'} />
            <span className="text-base font-editorial italic">
              {currentStreak} day streak
            </span>
            {(streakData?.longest ?? 0) > currentStreak && (
              <span className="text-sm font-mono text-muted ml-1">
                (best: {streakData?.longest})
              </span>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
