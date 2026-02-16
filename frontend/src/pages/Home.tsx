import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Play, BarChart3, Trophy, Flame } from 'lucide-react';
import { useTodaysChallenge, useStreak } from '../hooks/useChallenge';
import { cn } from '../lib/utils';
import { LegendScoreBadge } from '../components/game/LegendScoreBadge';

export function Home() {
  const navigate = useNavigate();
  const { data, isLoading } = useTodaysChallenge();
  const { data: streakData } = useStreak();

  const challenge = data?.challenge;
  const session = data?.session;
  const isCompleted = session?.status === 'completed';
  const isInProgress = session?.status === 'in_progress';

  return (
    <div className="flex-1 flex flex-col items-center max-w-lg mx-auto w-full px-5 py-8">
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <h1 className="font-display text-5xl font-black text-cream tracking-tight">
          SANDLOT
        </h1>
        <p className="text-sm text-gold font-mono mt-1 tracking-widest uppercase">
          Daily Baseball Draft
        </p>
      </motion.div>

      {/* Today's Challenge Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="w-full premium-card rounded-2xl p-6 mb-5"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !challenge ? (
          <div className="text-center py-6">
            <p className="text-cream/60 text-sm">No challenge today.</p>
            <p className="text-cream/40 text-xs mt-1">Check back tomorrow!</p>
          </div>
        ) : isCompleted && session ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-cream/40 uppercase tracking-wider font-bold">Today's Result</p>
                <p className="text-cream/60 text-xs font-mono mt-0.5">{challenge.date}</p>
              </div>
              <LegendScoreBadge score={session.totalLegendScore ?? 0} size="md" showLabel />
            </div>

            {session.percentile !== null && (
              <div className="bg-navy-light/40 rounded-xl p-3 mb-4">
                <p className="text-center text-sm text-cream/80">
                  You scored better than{' '}
                  <span className="font-bold text-gold font-mono">
                    {Math.round(session.percentile)}%
                  </span>{' '}
                  of players
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => navigate(`/results/${challenge.id}`)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-cream/10 text-cream font-bold text-sm hover:bg-cream/20 transition-all min-h-[44px]"
              >
                <BarChart3 size={16} />
                View Results
              </button>
              <button
                onClick={() => navigate('/leaderboard')}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-cream/10 text-cream font-bold text-sm hover:bg-cream/20 transition-all min-h-[44px]"
              >
                <Trophy size={16} />
                Leaderboard
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-center mb-5">
              <p className="text-xs text-cream/40 uppercase tracking-wider font-bold mb-1">
                {isInProgress ? 'Game In Progress' : "Today's Challenge"}
              </p>
              {challenge.theme && (
                <p className="text-sm text-gold italic">"{challenge.theme}"</p>
              )}
              <p className="text-cream/60 text-xs font-mono mt-1">{challenge.date}</p>
            </div>

            <p className="text-center text-sm text-cream/60 mb-5">
              10 rounds. 3 players. Pick the legend.
              <br />
              <span className="text-cream/40">Same slate as everyone else.</span>
            </p>

            <button
              onClick={() => navigate('/play')}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-4 rounded-xl',
                'bg-gold text-navy font-bold text-base',
                'hover:bg-gold-light active:scale-[0.98] transition-all',
                'pulse-glow min-h-[52px]',
              )}
            >
              <Play size={20} fill="currentColor" />
              {isInProgress ? 'Resume Draft' : 'Play Today'}
            </button>
          </>
        )}
      </motion.div>

      {/* Streak */}
      {streakData && streakData.current > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-orange-500/10 border border-orange-500/20 mb-5"
        >
          <Flame size={18} className="text-orange-400" />
          <span className="text-sm font-bold text-orange-400">
            {streakData.current} day streak
          </span>
          {streakData.longest > streakData.current && (
            <span className="text-xs text-cream/40 ml-1">
              (best: {streakData.longest})
            </span>
          )}
        </motion.div>
      )}

      {/* Quick nav */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45 }}
        onClick={() => navigate('/leaderboard')}
        className="text-sm text-cream/40 hover:text-cream/60 transition-colors"
      >
        View Leaderboard
      </motion.button>
    </div>
  );
}
