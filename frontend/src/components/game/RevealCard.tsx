import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import type { RevealData, RevealRoundPlayer } from '../../types';
import { LegendScoreBadge } from './LegendScoreBadge';
import { PaperCard } from '../ui/PaperCard';
import { PlayerPortrait } from './PlayerPortrait';
import { zToPercentile, getDisplayStats } from '../../lib/statBenchmark';
import { renderBlurb } from '../../lib/renderBlurb';

interface RevealCardProps {
  reveal: RevealData;
}

const CONFETTI_COLORS = ['#0A1E2F', '#D32F2F', '#C9A84C'];

function TickerTapeConfetti() {
  const pieces = useMemo(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: `${5 + Math.random() * 90}%`,
      delay: Math.random() * 0.6,
      duration: 2.5 + Math.random() * 1.5,
      color: CONFETTI_COLORS[i % 3],
      drift: Math.round((Math.random() - 0.5) * 40),
      initialRotation: Math.round(Math.random() * 360),
    })),
  []);

  return (
    <div className="confetti-container">
      {pieces.map(p => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            left: p.left,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--drift': `${p.drift}px`,
            transform: `rotate(${p.initialRotation}deg)`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

function StatBenchmark({ label, value, percentile, delay }: {
  label: string;
  value: string;
  percentile: number | null;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="flex flex-col items-center gap-0.5 py-2 px-1"
    >
      <span className="text-[10px] uppercase tracking-wider text-muted font-mono leading-none">
        {label}
      </span>
      <span className="font-mono font-bold text-xl text-navy leading-none mt-1">
        {value}
      </span>
      {percentile !== null && (
        <div className="w-full mt-1.5">
          <div className="h-1 bg-navy/10 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${percentile}%` }}
              transition={{ delay: delay + 0.3, duration: 0.6, ease: 'easeOut' }}
              className="h-full rounded-full bg-navy"
            />
          </div>
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: delay + 0.6 }}
            className="text-[9px] font-mono text-muted block text-center mt-0.5 tabular-nums"
          >
            {percentile}%
          </motion.span>
        </div>
      )}
    </motion.div>
  );
}

/** Community picks grouped by player, with year breakdown */
function CommunityPicks({
  roundPlayers,
  pickPercentages,
  chosenPlayerName,
  chosenYear,
}: {
  roundPlayers: RevealRoundPlayer[];
  pickPercentages: { playerId: number; year: number; percentage: number }[];
  chosenPlayerName: string;
  chosenYear: number;
}) {
  // Build a lookup: playerId -> { year -> percentage }
  const pctMap = useMemo(() => {
    const m = new Map<number, Map<number, number>>();
    for (const pp of pickPercentages) {
      if (!m.has(pp.playerId)) m.set(pp.playerId, new Map());
      m.get(pp.playerId)!.set(pp.year, pp.percentage);
    }
    return m;
  }, [pickPercentages]);

  const maxPct = Math.max(...pickPercentages.map(p => p.percentage), 1);

  return (
    <div className="space-y-3">
      <p className="text-[9px] uppercase tracking-widest text-muted font-mono text-center">
        Community Picks
      </p>
      {roundPlayers.map((player, pi) => {
        const isChosenPlayer = player.name === chosenPlayerName;

        return (
          <div key={pi} className="flex gap-2 items-start">
            <PlayerPortrait
              name={player.name}
              portraitUrl={player.portraitUrl}
              position=""
              size="sm"
              className="flex-shrink-0 mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <p className={cn(
                'text-xs font-editorial font-bold truncate leading-tight mb-1',
                isChosenPlayer ? 'text-navy' : 'text-navy/60',
              )}>
                {player.name}
              </p>
              {player.yearOptions.map(yo => {
                // Each year option has its own playerRecordId — look up directly
                const pct = pctMap.get(yo.playerRecordId)?.get(yo.year) ?? 0;
                const isChosenYearRow = isChosenPlayer && yo.year === chosenYear;
                return (
                  <div key={yo.year} className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-mono text-[10px] text-muted w-8 flex-shrink-0">
                      {yo.year}
                    </span>
                    <div className="flex-1 h-2.5 bg-navy/8 rounded overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(pct / maxPct) * 100}%` }}
                        transition={{ delay: 1.4 + pi * 0.1, duration: 0.5, ease: 'easeOut' }}
                        className={cn(
                          'h-full rounded',
                          isChosenYearRow ? 'bg-red' : 'bg-navy/20',
                        )}
                      />
                    </div>
                    <span className={cn(
                      'text-[10px] font-mono font-bold w-8 text-right tabular-nums',
                      isChosenYearRow ? 'text-red' : 'text-muted',
                    )}>
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RevealCard({ reveal }: RevealCardProps) {
  const pickPcts = reveal.pickPercentages ?? [];
  const isLegendary = reveal.legendScore >= 9.5;

  const displayStats = useMemo(() => {
    const configs = getDisplayStats(reveal.playerType);
    return configs.map(cfg => {
      const rawValue = reveal.stats[cfg.statKey] ?? reveal.stats[cfg.statKey.toLowerCase()];
      const zScore = reveal.categoryZscores[cfg.key] ?? reveal.categoryZscores[cfg.key.toLowerCase()];
      let percentile: number | null = null;
      if (cfg.hasPercentile && zScore !== undefined) {
        percentile = zToPercentile(zScore);
      }
      return {
        ...cfg,
        displayValue: rawValue !== undefined ? cfg.format(rawValue) : '--',
        percentile,
      };
    });
  }, [reveal.stats, reveal.categoryZscores, reveal.playerType]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      className="w-full px-3"
    >
      {isLegendary && <TickerTapeConfetti />}

      <PaperCard
        className={cn(isLegendary && 'ring-2 ring-gold/30')}
        noPadding
      >
        {/* Year/Team header */}
        <div className="text-center py-2.5 border-b border-navy/10">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
            {reveal.year} — {reveal.team}
          </span>
        </div>

        <div className="p-4">
          {/* Portrait + Player name header */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex items-center gap-3 mb-3"
          >
            <PlayerPortrait
              name={reveal.playerName}
              portraitUrl={reveal.portraitUrl}
              size="lg"
              className="flex-shrink-0"
            />
            <h3 className={cn(
              'font-editorial font-black text-2xl leading-tight text-navy',
              isLegendary && 'text-gold',
            )}>
              {reveal.playerName}
            </h3>
          </motion.div>

          {/* Stat box score — 5-column newspaper line */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="border border-navy/12 rounded overflow-hidden mb-4"
          >
            <div className="grid grid-cols-5 divide-x divide-navy/10 bg-paper">
              {displayStats.map((stat, i) => (
                <StatBenchmark
                  key={stat.key}
                  label={stat.label}
                  value={stat.displayValue}
                  percentile={stat.percentile}
                  delay={0.4 + i * 0.08}
                />
              ))}
            </div>
          </motion.div>

          {/* Blurb box with badge floated top-right — text wraps around it */}
          {reveal.blurb && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="bg-[#E8E4D9] rounded p-4 mb-4 border border-navy/10"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 12, delay: 0.6 }}
                className="float-right ml-3 mb-2"
              >
                <LegendScoreBadge score={reveal.legendScore} size="lg" animate />
              </motion.div>
              <p className="font-mono text-[13px] leading-relaxed text-left" style={{ color: '#37474F', letterSpacing: '-0.02em' }}>
                {renderBlurb(reveal.blurb)}
              </p>
            </motion.div>
          )}

          {/* If no blurb, show badge standalone */}
          {!reveal.blurb && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 12, delay: 0.6 }}
              className="flex justify-center mb-4"
            >
              <LegendScoreBadge score={reveal.legendScore} size="lg" animate showLabel />
            </motion.div>
          )}

          {/* Community picks — redesigned with player grouping */}
          {pickPcts.length > 0 && reveal.roundPlayers && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2 }}
              className="mb-4"
            >
              <CommunityPicks
                roundPlayers={reveal.roundPlayers}
                pickPercentages={pickPcts}
                chosenPlayerName={reveal.playerName}
                chosenYear={reveal.year}
              />
            </motion.div>
          )}

          {/* Fallback: old-style bars if no roundPlayers data */}
          {pickPcts.length > 0 && !reveal.roundPlayers && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2 }}
              className="space-y-1.5 mb-4"
            >
              <p className="text-[9px] uppercase tracking-widest text-muted font-mono text-center mb-2">
                Community Picks
              </p>
              {pickPcts.map(pp => {
                const maxPct = Math.max(...pickPcts.map(p => p.percentage), 1);
                return (
                  <div key={`${pp.playerId}-${pp.year}`} className="flex items-center gap-2">
                    <div className="flex-1 h-3 bg-navy/8 rounded overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(pp.percentage / maxPct) * 100}%` }}
                        transition={{ delay: 1.4, duration: 0.6, ease: 'easeOut' }}
                        className={cn(
                          'h-full rounded',
                          pp.year === reveal.year ? 'bg-red' : 'bg-navy/20',
                        )}
                      />
                    </div>
                    <span className="text-xs font-mono font-bold text-muted w-10 text-right">
                      {pp.percentage}%
                    </span>
                  </div>
                );
              })}
            </motion.div>
          )}
        </div>
      </PaperCard>
    </motion.div>
  );
}
