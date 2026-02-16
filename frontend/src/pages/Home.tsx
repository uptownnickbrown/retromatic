import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Play, BarChart3, Trophy, Flame } from 'lucide-react';
import { useTodaysChallenge, useStreak } from '../hooks/useChallenge';
import { cn } from '../lib/utils';
import { LegendScoreBadge } from '../components/game/LegendScoreBadge';
import { safeNum } from '../lib/numeric';

export function Home() {
  const navigate = useNavigate();
  const { data, isLoading } = useTodaysChallenge();
  const { data: streakData } = useStreak();

  const challenge = data?.challenge;
  const session = data?.session;
  const isCompleted = session?.status === 'completed';
  const isInProgress = session?.status === 'in_progress';

  return (
    <div className="flex-1 flex flex-col items-center max-w-lg mx-auto w-full px-5 py-6">
      {/* Logo — big, bold, retro */}
      <motion.div
        initial={{ opacity: 0, y: -30, scale: 0.8 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="text-center mb-6"
      >
        <div className="relative inline-block">
          <h1
            className="font-display text-6xl text-cardboard tracking-tight leading-none"
            style={{
              textShadow: '3px 3px 0 var(--color-field-dark), -1px -1px 0 rgba(255,255,255,0.1)',
              WebkitTextStroke: '1px rgba(0,0,0,0.2)',
            }}
          >
            SANDLOT
          </h1>
          {/* Red underline swoosh */}
          <div
            className="h-1.5 rounded-full mt-1 mx-auto"
            style={{
              width: '80%',
              background: 'linear-gradient(90deg, transparent, var(--color-card-red), var(--color-card-red), transparent)',
            }}
          />
        </div>
        <p className="text-sm text-cardboard/70 font-body font-bold mt-2 tracking-widest uppercase">
          Daily Baseball Draft
        </p>
      </motion.div>

      {/* Today's Challenge Card */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 180, damping: 18 }}
        className="w-full card p-5 mb-4"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-3 border-card-red border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !challenge ? (
          <div className="text-center py-6">
            <p className="text-field-dark/60 text-sm font-body">No challenge today.</p>
            <p className="text-field-dark/40 text-xs font-body mt-1">Check back tomorrow!</p>
          </div>
        ) : isCompleted && session ? (
          <>
            <div className="flex items-center justify-between mb-4 relative z-10">
              <div>
                <p className="card-banner text-[10px] inline-block mb-1">Today's Result</p>
                <p className="text-field-dark/50 text-xs font-score mt-1">{challenge.date}</p>
              </div>
              <LegendScoreBadge score={safeNum(session.totalLegendScore)} size="md" showLabel />
            </div>

            {session.percentile !== null && (
              <div className="dirt-card p-3 mb-4 relative z-10">
                <p className="text-center text-sm font-body text-cardboard-light">
                  You scored better than{' '}
                  <span className="font-heading text-amber-light text-lg">
                    {Math.round(safeNum(session.percentile, 50))}%
                  </span>{' '}
                  of players
                </p>
              </div>
            )}

            <div className="flex gap-3 relative z-10">
              <button
                onClick={() => navigate(`/results/${challenge.id}`)}
                className="card-banner-blue flex-1 flex items-center justify-center gap-2 py-3 text-sm min-h-[44px]"
              >
                <BarChart3 size={16} />
                Results
              </button>
              <button
                onClick={() => navigate('/leaderboard')}
                className="card-banner-blue flex-1 flex items-center justify-center gap-2 py-3 text-sm min-h-[44px]"
              >
                <Trophy size={16} />
                Leaderboard
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-center mb-4 relative z-10">
              <p className="card-banner text-[10px] inline-block mb-2">
                {isInProgress ? 'Game In Progress' : "Today's Challenge"}
              </p>
              {challenge.theme && (
                <p className="text-base text-field-dark font-typewriter mt-2">"{challenge.theme}"</p>
              )}
              <p className="text-field-dark/50 text-xs font-score mt-1">{challenge.date}</p>
            </div>

            <p className="text-center text-sm text-field-dark/70 font-body mb-5 relative z-10">
              10 rounds. 3 players. Pick the legend.
              <br />
              <span className="text-field-dark/40">Same slate as everyone else.</span>
            </p>

            <button
              onClick={() => navigate('/play')}
              className={cn(
                'card-banner w-full flex items-center justify-center gap-2 py-4 text-lg min-h-[52px] relative z-10',
                'hover:brightness-110 active:scale-[0.98] transition-all',
              )}
            >
              <Play size={22} fill="currentColor" />
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
          className="w-full dirt-card flex items-center justify-center gap-2 py-3 px-4 mb-4"
        >
          <span className="fire-flicker inline-block">
            <Flame size={20} className="text-amber-light" />
          </span>
          <span className="text-sm font-heading text-amber-light">
            {streakData.current} day streak
          </span>
          {streakData.longest > streakData.current && (
            <span className="text-xs text-cardboard/40 font-body ml-1">
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
        className="text-sm text-cardboard/40 hover:text-cardboard/70 transition-colors font-body"
      >
        View Leaderboard
      </motion.button>
    </div>
  );
}
