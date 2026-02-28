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
  const hit = streak > 0 ? getStreakMilestone(streak) : null;
  const lastCelebrated = parseInt(localStorage.getItem(CELEBRATED_KEY) ?? '0', 10);

  const [celebratedMilestone] = useState<number | null>(() => {
    if (hit !== null && hit > lastCelebrated) {
      localStorage.setItem(CELEBRATED_KEY, String(hit));
      return hit;
    }
    return null;
  });

  // Milestone stays visible (no auto-dismiss)
  const showCelebration = celebratedMilestone !== null;
  return { showCelebration, milestone: celebratedMilestone };
}

/** Returns "Yesterday" if dateStr is yesterday in ET, otherwise a formatted date like "Wed, Feb 25" */
function getPastChallengeLabel(dateStr: string): string {
  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const todayDate = new Date(todayET + 'T12:00:00');
  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toLocaleDateString('en-CA');

  if (dateStr === yesterdayStr) return 'Yesterday';

  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function Home() {
  const navigate = useNavigate();
  const { data, isLoading } = useHomeData();
  const { data: streakData } = useStreak();

  const today = data?.today;
  const session = data?.session;
  const pastChallenges = data?.pastChallenges ?? [];
  const tomorrow = data?.tomorrow;
  const isCompleted = session?.status === 'completed';
  const isInProgress = session?.status === 'in_progress';
  const currentStreak = streakData?.current ?? 0;
  const gamesPlayed = streakData?.gamesPlayed ?? 0;
  const averageScore = streakData?.averageScore ?? 0;
  const averagePercentile = streakData?.averagePercentile ?? 0;
  const { showCelebration, milestone } = useStreakMilestone(currentStreak);

  return (
    <div className="flex-1 flex flex-col items-center max-w-lg mx-auto w-full px-3 pt-5 safe-bottom">
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
                {currentStreak > 0 && (
                  <div className="flex items-center justify-center gap-1.5 mt-2">
                    <Flame size={14} className={currentStreak >= 7 ? 'text-gold' : 'text-navy/40'} />
                    <span className="font-mono text-xs text-muted">
                      {currentStreak} day streak
                    </span>
                  </div>
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

      {/* Post-completion: Streak display */}
      {isCompleted && currentStreak > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 200, damping: 18 }}
          className="w-full mb-4"
        >
          <PaperCard>
            <div className="text-center">
              {showCelebration && milestone && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                  className="mb-3"
                >
                  <p className="font-editorial font-bold text-xl text-gold leading-tight">
                    {milestone}-day streak!
                  </p>
                  <p className="font-mono text-sm text-navy/60 mt-0.5">
                    {MILESTONE_TEXT[milestone]}
                  </p>
                </motion.div>
              )}

              <div className="flex items-center justify-center gap-2">
                <Flame size={22} className={currentStreak >= 7 ? 'text-gold' : 'text-navy'} />
                <span className="text-2xl font-editorial font-bold text-navy">
                  {currentStreak}
                </span>
                <span className="font-mono text-sm text-muted uppercase tracking-wider">
                  day streak
                </span>
              </div>

              {(streakData?.longest ?? 0) > currentStreak && (
                <p className="font-mono text-xs text-muted mt-1">
                  Personal best: {streakData?.longest} days
                </p>
              )}
            </div>
          </PaperCard>
        </motion.div>
      )}

      {/* Post-completion: Your Season stats */}
      {isCompleted && gamesPlayed > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="w-full mb-4"
        >
          <PaperCard>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.15em] text-muted mb-3 text-center">
              Your Season
            </p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="font-editorial font-bold text-xl text-navy">
                  {averageScore.toFixed(1)}
                </p>
                <p className="font-mono text-[10px] text-muted uppercase tracking-wider">
                  Avg Score
                </p>
              </div>
              <div>
                <p className="font-editorial font-bold text-xl text-navy">
                  {Math.round(averagePercentile)}%
                </p>
                <p className="font-mono text-[10px] text-muted uppercase tracking-wider">
                  Avg Percentile
                </p>
              </div>
              <div>
                <p className="font-editorial font-bold text-xl text-navy">
                  {gamesPlayed}
                </p>
                <p className="font-mono text-[10px] text-muted uppercase tracking-wider">
                  Games Played
                </p>
              </div>
            </div>
          </PaperCard>
        </motion.div>
      )}

      {/* Post-completion: Come back tomorrow */}
      {isCompleted && tomorrow && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="w-full mb-4"
        >
          <PaperCard>
            <div className="text-center">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.15em] text-muted mb-1">
                Tomorrow
              </p>
              {tomorrow.theme ? (
                <p className="text-lg text-navy font-editorial italic">
                  "{tomorrow.theme}"
                </p>
              ) : (
                <p className="text-base text-navy font-editorial italic">
                  A new challenge awaits
                </p>
              )}
              <p className="font-mono text-xs text-muted mt-2">
                Same time, same sandlot.
              </p>
            </div>
          </PaperCard>
        </motion.div>
      )}

      {/* Past Challenges section */}
      {pastChallenges.length > 0 && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: isCompleted ? 0.55 : 0.3 }}
            className="w-full mb-3"
          >
            <div className="flex items-baseline gap-3">
              <h2 className="font-editorial font-bold text-navy text-sm uppercase tracking-wider whitespace-nowrap">
                Past Challenges
              </h2>
              <div className="flex-1 ink-divider" />
            </div>
          </motion.div>

          {pastChallenges.map((challenge, index) => (
            <motion.div
              key={challenge.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: (isCompleted ? 0.6 : 0.35) + index * 0.05 }}
              className="w-full mb-2"
            >
              <PaperCard>
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-bold uppercase tracking-[0.15em] text-muted">
                      {getPastChallengeLabel(challenge.date)}
                    </p>
                    {challenge.theme && (
                      <p className="text-base text-navy font-editorial italic mt-0.5 truncate">
                        "{challenge.theme}"
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => navigate(`/recap/${challenge.id}`)}
                    className="flex items-center gap-1 text-sm font-mono text-navy/60 hover:text-navy transition-colors flex-shrink-0 ml-3 py-1"
                  >
                    Recap / Play Again
                    <ChevronRight size={14} />
                  </button>
                </div>
              </PaperCard>
            </motion.div>
          ))}
        </>
      )}
    </div>
  );
}
