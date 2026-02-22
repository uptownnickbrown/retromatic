import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart3, Flame, ChevronRight } from 'lucide-react';
import { useHomeData, useStreak } from '../hooks/useChallenge';
import { SandlotScoreBadge } from '../components/game/SandlotScoreBadge';
import { PaperCard } from '../components/ui/PaperCard';
import { VintageButton } from '../components/ui/VintageButton';
import { safeNum } from '../lib/numeric';

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

  return (
    <div className="flex-1 flex flex-col items-center max-w-lg mx-auto w-full px-3 py-5">
      {/* Masthead */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        className="text-center mb-8 w-full"
      >
        <h1 className="font-editorial font-black text-6xl text-navy tracking-tight leading-none">
          SANDLOT
        </h1>
        <div className="ink-divider my-2" />
        <p className="font-mono text-xs text-muted uppercase tracking-[0.2em]">
          Daily Baseball Draft
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
              <p className="text-muted text-sm font-mono">No challenge today.</p>
              <p className="text-muted/60 text-xs font-mono mt-1">Check back tomorrow!</p>
            </div>
          ) : isCompleted && session ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                    Today's Result
                  </p>
                  {today.theme && (
                    <p className="text-sm text-navy font-editorial italic mt-1">"{today.theme}"</p>
                  )}
                </div>
                <SandlotScoreBadge score={safeNum(session.totalLegendScore) / 10} size="md" showLabel />
              </div>

              {session.percentile != null && (
                <div className="bg-bone rounded p-3 mb-4 border border-navy/8">
                  <p className="text-center text-sm font-mono text-navy">
                    You scored better than{' '}
                    <span className="font-editorial font-bold text-lg">
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
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted mb-2">
                  {isInProgress ? 'Game In Progress' : "Today's Challenge"}
                </p>
                {today.theme && (
                  <p className="text-lg text-navy font-editorial italic mt-1">"{today.theme}"</p>
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
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-muted mb-2">
              How to Play
            </p>
            <p className="text-xs text-navy/80 font-mono leading-relaxed">
              A daily fantasy baseball draft through history. Each round, choose from 3 legendary
              players — and 3 of their seasons — to fill a roster position. 10 rounds, 10 positions.
            </p>
            <p className="text-xs text-navy/60 font-mono leading-relaxed mt-2">
              Maximize your Sandlot Score (1.0–10.0). Score 9.5+ to unearth a Sandlot Legend.
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
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-muted">
                  Yesterday
                </p>
                {yesterday.theme && (
                  <p className="text-sm text-navy font-editorial italic mt-1 truncate">
                    "{yesterday.theme}"
                  </p>
                )}
              </div>
              <button
                onClick={() => navigate(`/recap/${yesterday.id}`)}
                className="flex items-center gap-1 text-xs font-mono text-navy/60 hover:text-navy transition-colors flex-shrink-0 ml-3 py-1"
              >
                Community recap
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
          <p className="font-mono text-xs text-muted/70">
            Come back tomorrow for{' '}
            {tomorrow.theme ? (
              <span className="font-editorial italic text-navy/60">"{tomorrow.theme}"</span>
            ) : (
              'a new challenge'
            )}
          </p>
        </motion.div>
      )}

      {/* Streak */}
      {streakData && streakData.current > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex items-center gap-2 text-navy/50"
        >
          <Flame size={16} className="text-navy/40" />
          <span className="text-sm font-editorial italic">
            {streakData.current} day streak
          </span>
          {streakData.longest > streakData.current && (
            <span className="text-xs font-mono text-muted ml-1">
              (best: {streakData.longest})
            </span>
          )}
        </motion.div>
      )}
    </div>
  );
}
