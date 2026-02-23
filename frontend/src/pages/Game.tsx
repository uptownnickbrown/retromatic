import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '../hooks/useGame';
import { useTimer } from '../hooks/useTimer';
import { Timer } from '../components/game/Timer';
import { LineupCard } from '../components/game/LineupCard';
import { PickGrid } from '../components/game/PickGrid';
import { RevealCard } from '../components/game/RevealCard';
import { VintageButton } from '../components/ui/VintageButton';
import { PaperCard } from '../components/ui/PaperCard';
import { Loader2, FlaskConical, Home } from 'lucide-react';
import { cn } from '../lib/utils';
import { safeNum } from '../lib/numeric';

const POSITION_NAMES: Record<string, string> = {
  C: 'Catcher',
  '1B': '1st Base',
  '2B': '2nd Base',
  SS: 'Shortstop',
  '3B': '3rd Base',
  OF: 'Outfield',
  UTIL: 'Utility',
  SP: 'Starting Pitcher',
  RP: 'Relief Pitcher',
  P: 'Pitcher',
};

export function Game() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const playtestId = searchParams.get('playtest');
  const playtestChallengeId = playtestId ? parseInt(playtestId) : null;
  const replayId = searchParams.get('replay');
  const replayChallengeId = replayId ? parseInt(replayId) : null;
  const [isPaused, setIsPaused] = useState(false);

  const game = useGame();

  const handleTimeout = useCallback(() => {
    if (game.phase !== 'picking' || !game.currentRound || game.isSubmitting.current) return;
    const players = game.currentRound.players;
    const randomPlayer = players[Math.floor(Math.random() * players.length)];
    const randomYear = randomPlayer.yearOptions[Math.floor(Math.random() * randomPlayer.yearOptions.length)];
    game.submitPick(randomYear.playerRecordId, randomYear.year, true);
  }, [game.phase, game.currentRound, game.submitPick, game.isSubmitting]);

  const timer = useTimer({
    duration: game.currentRound?.timeLimit ?? 30,
    onExpire: handleTimeout,
  });

  useEffect(() => {
    if (playtestChallengeId) {
      game.loadPlaytest(playtestChallengeId);
    } else if (replayChallengeId) {
      game.loadReplay(replayChallengeId);
    } else {
      game.loadAndStart();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (game.phase === 'picking') {
      timer.reset(game.currentRound?.timeLimit ?? 30);
      timer.start();
    } else {
      timer.stop();
    }
  }, [game.phase, game.currentRound?.roundId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (game.phase === 'submitting_final') {
      game.submitFinal();
    }
  }, [game.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (game.phase === 'complete' && game.challenge) {
      if (game.isPlaytest) {
        navigate(`/results/${game.challenge.id}?playtest=true`, {
          replace: true,
          state: { playtestResults: game.playtestResults, challengeId: game.challenge.id },
        });
      } else if (game.isReplay) {
        navigate(`/results/${game.challenge.id}?replay=true`, {
          replace: true,
          state: { playtestResults: game.playtestResults, challengeId: game.challenge.id },
        });
      } else {
        navigate(`/results/${game.challenge.id}`, { replace: true });
      }
    }
  }, [game.phase, game.challenge, game.isPlaytest, game.isReplay, game.playtestResults, navigate]);

  const handlePick = useCallback((playerId: number, year: number) => {
    timer.stop();
    game.submitPick(playerId, year);
  }, [timer.stop, game.submitPick]);

  const handleContinue = useCallback(() => {
    game.advanceRound();
  }, [game.advanceRound]);

  const handlePause = useCallback(() => {
    timer.stop();
    setIsPaused(true);
  }, [timer.stop]);

  const handleResume = useCallback(() => {
    setIsPaused(false);
    if (game.phase === 'picking') {
      timer.start();
    }
  }, [game.phase, timer.start]);

  const handleQuit = useCallback(() => {
    setIsPaused(false);
    navigate('/');
  }, [navigate]);

  const positions = game.challenge?.positionOrder ?? [];
  const totalScore = game.picks.reduce((sum, p) => sum + safeNum(p.legendScore), 0);
  const showHomeIcon = (game.phase === 'picking' || game.phase === 'revealing') && !game.isPlaytest;

  if (game.phase === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
          <Loader2 className="w-6 h-6 text-navy" />
        </motion.div>
      </div>
    );
  }

  if (game.error && !game.challenge) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-muted text-sm font-mono mb-4">{game.error}</p>
        <VintageButton variant="section" onClick={() => navigate(game.isPlaytest ? '/admin' : '/')}>
          {game.isPlaytest ? 'Back to Admin' : 'Back Home'}
        </VintageButton>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full safe-bottom relative">
      {/* Home icon + Pause overlay */}
      {showHomeIcon && (
        <button
          onClick={handlePause}
          className="absolute top-3 left-3 z-20 p-2 text-navy/40 hover:text-navy transition-colors"
          aria-label="Home"
        >
          <Home size={20} />
        </button>
      )}

      <AnimatePresence>
        {isPaused && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-navy/40"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            >
              <PaperCard className="p-6 w-72 text-center">
                <h3 className="font-editorial font-bold text-xl text-navy mb-6">
                  Game Paused
                </h3>
                <div className="flex flex-col gap-3">
                  <VintageButton variant="ticket" onClick={handleResume} className="w-full">
                    Resume Draft
                  </VintageButton>
                  <button
                    onClick={handleQuit}
                    className="btn-ghost text-sm"
                  >
                    Quit to Home
                  </button>
                </div>
              </PaperCard>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Playtest banner */}
      {game.isPlaytest && (
        <div className="bg-gold/15 border-b-2 border-gold/30 px-4 py-2 flex items-center justify-center gap-2">
          <FlaskConical className="w-3.5 h-3.5 text-gold" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-navy/70">
            Playtest Mode
          </span>
        </div>
      )}

      {/* Error banner */}
      {game.error && game.challenge && (
        <div className="mx-3 mt-2 px-3 py-2 rounded bg-red/10 border border-red/20 text-red text-xs font-mono text-center">
          {game.error}
        </div>
      )}

      {/* Lineup card tracker */}
      <div className="px-3 pt-2">
        <LineupCard
          totalRounds={game.totalRounds}
          currentRound={game.roundNumber}
          picks={game.picks}
          positions={positions}
          totalScore={totalScore}
        />
      </div>

      {/* Position + Timer — single clean row */}
      {game.phase === 'picking' && game.currentRound && (
        <div className="px-4 pt-2 pb-1 flex items-center justify-between">
          <h2 className="font-editorial font-bold text-navy text-xl">
            {POSITION_NAMES[game.currentRound.position] ?? game.currentRound.position}
          </h2>
          <div className="w-[180px]">
            <Timer
              timeLeft={timer.timeLeft}
              progress={timer.progress}
              isUrgent={timer.isUrgent}
            />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col justify-center py-2">
        <AnimatePresence mode="wait">
          {game.phase === 'picking' && game.currentRound && (
            <motion.div
              key={`pick-${game.currentRound.roundId}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <PickGrid
                players={game.currentRound.players}
                position={game.currentRound.position}
                onPick={handlePick}
              />
            </motion.div>
          )}

          {game.phase === 'submitting_final' && (
            <motion.div
              key="submitting-final"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-12 gap-3"
            >
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                <Loader2 className="w-6 h-6 text-navy" />
              </motion.div>
              <p className="text-muted text-sm font-mono">
                {game.isPlaytest ? 'Finishing playtest...' : game.isReplay ? 'Computing your score...' : 'Submitting your lineup...'}
              </p>
            </motion.div>
          )}

          {game.phase === 'revealing' && game.reveal && (
            <motion.div
              key="reveal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <RevealCard reveal={game.reveal} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Fixed "Next Round" button — pinned above iOS toolbar */}
      {game.phase === 'revealing' && game.reveal && (
        <div className="fixed bottom-0 left-0 right-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 bg-bone">
          <div className="max-w-lg mx-auto">
            <button
              onClick={handleContinue}
              className={cn(
                'w-full font-mono font-bold text-base uppercase tracking-wider py-3.5 rounded',
                'transition-transform duration-100 active:translate-y-0.5',
                !game.currentRound
                  ? 'bg-red text-white border-2 border-red-dark shadow-[2px_2px_0px_#0A1E2F]'
                  : 'bg-navy text-paper border-2 border-navy shadow-[2px_2px_0px_rgba(10,30,47,0.3)]',
              )}
            >
              {!game.currentRound ? 'See Results' : 'Next Round'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
