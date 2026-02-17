import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '../hooks/useGame';
import { useTimer } from '../hooks/useTimer';
import { Timer } from '../components/game/Timer';
import { RosterStrip } from '../components/game/RosterStrip';
import { PickGrid } from '../components/game/PickGrid';
import { RevealCard } from '../components/game/RevealCard';
import { Loader2 } from 'lucide-react';
import { safeNum } from '../lib/numeric';

export function Game() {
  const navigate = useNavigate();
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

  // Load + start on mount (checks localStorage first, then server)
  useEffect(() => {
    game.loadAndStart();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Start timer when picking
  useEffect(() => {
    if (game.phase === 'picking') {
      timer.reset(game.currentRound?.timeLimit ?? 30);
      timer.start();
    } else {
      timer.stop();
    }
  }, [game.phase, game.currentRound?.roundId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-submit when all rounds complete
  useEffect(() => {
    if (game.phase === 'submitting_final') {
      game.submitFinal();
    }
  }, [game.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate to results when complete
  useEffect(() => {
    if (game.phase === 'complete' && game.challenge) {
      navigate(`/results/${game.challenge.id}`, { replace: true });
    }
  }, [game.phase, game.challenge, navigate]);

  const handlePick = useCallback((playerId: number, year: number) => {
    timer.stop();
    game.submitPick(playerId, year);
  }, [timer.stop, game.submitPick]);

  const handleContinue = useCallback(() => {
    game.advanceRound();
  }, [game.advanceRound]);

  const positions = game.challenge?.positionOrder ?? [];

  if (game.phase === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
          <Loader2 className="w-8 h-8 text-amber" />
        </motion.div>
      </div>
    );
  }

  if (game.error && !game.challenge) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-cardboard/60 text-sm font-body mb-4">{game.error}</p>
        <button
          onClick={() => navigate('/')}
          className="card-banner-blue px-6 py-3 text-sm min-h-[44px]"
        >
          Back Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full safe-bottom">
      {/* Error banner */}
      {game.error && game.challenge && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200 text-xs font-body text-center">
          {game.error}
        </div>
      )}

      {/* Header: scoreboard strip */}
      <div className="px-3 pt-2">
        <RosterStrip
          totalRounds={game.totalRounds}
          currentRound={game.roundNumber}
          picks={game.picks}
          positions={positions}
        />
      </div>

      {/* Round info + Timer */}
      {game.phase === 'picking' && game.currentRound && (
        <div className="flex items-center justify-between px-4 py-2 gap-3">
          <div className="flex-shrink-0">
            <h2 className="font-heading text-cardboard text-lg leading-tight">
              Round {game.currentRound.roundNumber}
            </h2>
            <span className="card-banner text-[10px] inline-block py-0.5 px-2 mt-0.5">
              {game.currentRound.position}
            </span>
          </div>
          <div className="flex-1 max-w-[180px]">
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
                <Loader2 className="w-8 h-8 text-amber" />
              </motion.div>
              <p className="text-cardboard/60 text-sm font-body">Submitting your lineup...</p>
            </motion.div>
          )}

          {game.phase === 'revealing' && game.reveal && (
            <motion.div
              key="reveal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <RevealCard
                reveal={game.reveal}
                onContinue={handleContinue}
                isLastRound={!game.currentRound}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Running score — scoreboard style */}
      {game.picks.length > 0 && game.phase !== 'complete' && (
        <div className="text-center pb-3">
          <span className="scoreboard text-sm px-3 py-1">
            {game.picks.reduce((sum, p) => sum + safeNum(p.legendScore), 0).toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
}
