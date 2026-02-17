import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { safeNum } from '../../lib/numeric';
import { getDisplayStats } from '../../lib/statBenchmark';
import type { ResultsPick, PerfectLineupPick } from '../../types';

interface HeadToHeadProps {
  picks: ResultsPick[];
  perfectPicks: PerfectLineupPick[];
  yourTotal: number;
  perfectTotal: number;
}

const POSITION_LABELS: Record<string, string> = {
  C: 'Catcher', '1B': 'First Base', '2B': 'Second Base', SS: 'Shortstop',
  '3B': 'Third Base', OF: 'Outfield', UTIL: 'Utility',
  SP: 'Starting Pitcher', RP: 'Relief Pitcher', P: 'Pitcher',
};

export function HeadToHead({ picks, perfectPicks, yourTotal, perfectTotal }: HeadToHeadProps) {
  const [expandedRound, setExpandedRound] = useState<number | null>(null);

  const pctOfPerfect = perfectTotal > 0 ? Math.round((yourTotal / perfectTotal) * 100) : 0;

  // Match picks to perfect by roundNumber
  const matchups = picks.map(pick => {
    const perfect = perfectPicks.find(p => p.roundNumber === pick.roundNumber);
    const isMatch = perfect && pick.playerName === perfect.playerName && pick.year === perfect.year;
    return { pick, perfect, isMatch };
  });

  return (
    <div className="paper-card overflow-hidden">
      {/* Summary header */}
      <div className="px-4 py-4 border-b border-navy/10">
        <div className="flex items-center justify-between mb-1">
          <div className="text-center flex-1">
            <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted">Your Lineup</p>
            <p className="font-editorial font-bold text-2xl text-navy">{yourTotal.toFixed(1)}</p>
          </div>
          <div className="text-center px-3">
            <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted">vs</p>
          </div>
          <div className="text-center flex-1">
            <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted">Perfect</p>
            <p className="font-editorial font-bold text-2xl text-navy">{perfectTotal.toFixed(1)}</p>
          </div>
        </div>
        <p className="text-center font-mono text-xs text-muted">
          <span className="font-bold text-navy">{pctOfPerfect}%</span> of perfect
        </p>
      </div>

      {/* Position rows */}
      <div className="divide-y divide-navy/6">
        {matchups.map(({ pick, perfect, isMatch }) => {
          const isExpanded = expandedRound === pick.roundNumber;
          const yourScore = safeNum(pick.legendScore);
          const perfectScore = safeNum(perfect?.legendScore);
          const gap = perfectScore - yourScore;

          return (
            <div key={pick.roundNumber}>
              {/* Compact row */}
              <button
                onClick={() => setExpandedRound(isExpanded ? null : pick.roundNumber)}
                className="w-full flex items-center gap-1 px-3 py-2 text-left hover:bg-navy/3 transition-colors min-h-[44px]"
              >
                <span className="font-mono text-[10px] font-bold text-muted w-8 flex-shrink-0">
                  {pick.position}
                </span>
                <div className="flex-1 min-w-0 flex items-center gap-1">
                  <span className={cn(
                    'text-xs truncate',
                    gap > 3 ? 'text-muted' : 'text-navy',
                    pick.wasTimeout && 'line-through text-muted',
                  )}>
                    {pick.playerName.split(' ').pop()} '{String(pick.year).slice(2)}
                  </span>
                  <span className={cn(
                    'font-mono text-[11px] font-bold flex-shrink-0',
                    yourScore >= 9.5 ? 'text-gold' : yourScore >= 6.0 ? 'text-navy' : 'text-muted',
                  )}>
                    {yourScore.toFixed(1)}
                  </span>
                </div>
                <span className="text-muted/30 mx-0.5 flex-shrink-0">│</span>
                <div className="flex-1 min-w-0 flex items-center justify-end gap-1">
                  <span className={cn(
                    'font-mono text-[11px] font-bold flex-shrink-0',
                    perfectScore >= 9.5 ? 'text-gold' : 'text-navy',
                  )}>
                    {perfectScore.toFixed(1)}
                  </span>
                  <span className="text-xs text-navy truncate text-right">
                    {perfect?.playerName.split(' ').pop()} '{String(perfect?.year ?? 0).slice(2)}
                  </span>
                  {isMatch && (
                    <Check size={12} className="text-gold flex-shrink-0" />
                  )}
                </div>
              </button>

              {/* Expanded detail */}
              <AnimatePresence>
                {isExpanded && perfect && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <ExpandedMatchup pick={pick} perfect={perfect} isMatch={!!isMatch} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExpandedMatchup({ pick, perfect, isMatch }: {
  pick: ResultsPick;
  perfect: PerfectLineupPick;
  isMatch: boolean;
}) {
  const yourScore = safeNum(pick.legendScore);
  const perfectScore = safeNum(perfect.legendScore);
  const playerType = perfect.playerType ?? 'batter';
  const statConfigs = getDisplayStats(playerType);

  return (
    <div className="bg-bone/50 px-3 pb-3">
      {/* Position header */}
      <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted py-2">
        {pick.position} — {POSITION_LABELS[pick.position] ?? pick.position}
      </p>

      {/* Side-by-side names */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="text-center">
          <p className="font-editorial font-bold text-sm text-navy leading-tight">{pick.playerName}</p>
          <p className="font-mono text-[10px] text-muted">{pick.year} · {pick.team}</p>
          <p className={cn(
            'font-mono text-sm font-bold mt-0.5',
            yourScore >= 9.5 ? 'text-gold' : yourScore >= 6.0 ? 'text-navy' : 'text-muted',
          )}>
            LS: {yourScore.toFixed(1)}
          </p>
        </div>
        <div className="text-center">
          <p className="font-editorial font-bold text-sm text-navy leading-tight">
            {perfect.playerName}
            {isMatch && <Check size={12} className="inline ml-1 text-gold" />}
          </p>
          <p className="font-mono text-[10px] text-muted">{perfect.year} · {perfect.team ?? ''}</p>
          <p className={cn(
            'font-mono text-sm font-bold mt-0.5',
            perfectScore >= 9.5 ? 'text-gold' : 'text-navy',
          )}>
            LS: {perfectScore.toFixed(1)}
          </p>
        </div>
      </div>

      {/* 5-stat comparison */}
      {perfect.stats && (
        <div className="border border-navy/10 rounded overflow-hidden mb-3">
          {/* Header row */}
          <div className="grid grid-cols-[auto_repeat(5,1fr)] bg-navy/5">
            <div className="w-10" />
            {statConfigs.map(cfg => (
              <div key={cfg.key} className="text-center py-1">
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted">
                  {cfg.label}
                </span>
              </div>
            ))}
          </div>
          {/* Your stats row */}
          <div className="grid grid-cols-[auto_repeat(5,1fr)] border-t border-navy/8">
            <div className="w-10 flex items-center justify-center">
              <span className="text-[9px] font-mono font-bold text-muted">YOU</span>
            </div>
            {statConfigs.map(cfg => {
              const yourVal = pick.stats[cfg.statKey] ?? pick.stats[cfg.statKey.toLowerCase()];
              const perfectVal = perfect.stats?.[cfg.statKey] ?? perfect.stats?.[cfg.statKey.toLowerCase()];
              const isBetter = yourVal !== undefined && perfectVal !== undefined &&
                (cfg.inverted ? yourVal < perfectVal : yourVal > perfectVal);
              return (
                <div key={cfg.key} className="text-center py-1.5">
                  <span className={cn(
                    'font-mono text-xs tabular-nums',
                    isBetter ? 'font-bold text-navy' : 'text-muted',
                  )}>
                    {yourVal !== undefined ? cfg.format(yourVal) : '--'}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Perfect stats row */}
          <div className="grid grid-cols-[auto_repeat(5,1fr)] border-t border-navy/8">
            <div className="w-10 flex items-center justify-center">
              <span className="text-[9px] font-mono font-bold text-gold">✦</span>
            </div>
            {statConfigs.map(cfg => {
              const yourVal = pick.stats[cfg.statKey] ?? pick.stats[cfg.statKey.toLowerCase()];
              const perfectVal = perfect.stats?.[cfg.statKey] ?? perfect.stats?.[cfg.statKey.toLowerCase()];
              const isBetter = yourVal !== undefined && perfectVal !== undefined &&
                (cfg.inverted ? perfectVal < yourVal : perfectVal > yourVal);
              return (
                <div key={cfg.key} className="text-center py-1.5">
                  <span className={cn(
                    'font-mono text-xs tabular-nums',
                    isBetter ? 'font-bold text-navy' : 'text-muted',
                  )}>
                    {perfectVal !== undefined ? cfg.format(perfectVal) : '--'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Perfect player's blurb */}
      {perfect.blurb && (
        <div className="bg-bone rounded p-2 border border-navy/8 -rotate-[0.3deg]">
          <p className="text-base text-navy/70 font-hand leading-relaxed text-left">
            "{perfect.blurb}"
          </p>
        </div>
      )}
    </div>
  );
}
