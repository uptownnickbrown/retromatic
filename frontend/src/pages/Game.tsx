import { useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '../hooks/useGame';
import { useTimer } from '../hooks/useTimer';
import { Timer } from '../components/game/Timer';
import { LineupCard } from '../components/game/LineupCard';
import { PickGrid } from '../components/game/PickGrid';
import { RevealCard } from '../components/game/RevealCard';
import { VintageButton } from '../components/ui/VintageButton';
import { Loader2, FlaskConical } from 'lucide-react';
import { safeNum } from '../lib/numeric';

export function Game() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const playtestId = searchParams.get('playtest');
  const playtestChallengeId = playtestId ? parseInt(playtestId) : null;

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
        // Return to admin challenge detail with playtest flag
        navigate(`/admin/challenge/${game.challenge.id}?playtested=true`, { replace: true });
      } else {
        navigate(`/results/${game.challenge.id}`, { replace: true });
      }
    }
  }, [game.phase, game.challenge, game.isPlaytest, navigate]);

  const handlePick = useCallback((playerId: number, year: number) => {
    timer.stop();
    game.submitPick(playerId, year);
  }, [timer.stop, game.submitPick]);

  const handleContinue = useCallback(() => {
    game.advanceRound();
  }, [game.advanceRound]);

  const positions = game.challenge?.positionOrder ?? [];
  const totalScore = game.picks.reduce((sum, p) => sum + safeNum(p.legendScore), 0);

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
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full safe-bottom">
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

      {/* Round info + Timer */}
      {game.phase === 'picking' && game.currentRound && (
        <div className="flex items-center justify-between px-4 py-3 gap-3">
          <div className="flex-shrink-0">
            <h2 className="font-editorial font-bold text-navy text-xl leading-tight">
              Round {game.currentRound.roundNumber}
            </h2>
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
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
                <Loader2 className="w-6 h-6 text-navy" />
              </motion.div>
              <p className="text-muted text-sm font-mono">
                {game.isPlaytest ? 'Finishing playtest...' : 'Submitting your lineup...'}
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
              <RevealCard
                reveal={game.reveal}
                onContinue={handleContinue}
                isLastRound={!game.currentRound}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Running score */}
      {game.picks.length > 0 && game.phase !== 'complete' && (
        <div className="text-center pb-3">
          <span className="mono-stat text-sm">
            {totalScore.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
}
