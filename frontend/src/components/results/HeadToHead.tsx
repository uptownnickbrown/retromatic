import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { POSITIONS } from '../../types';
import { safeNum } from '../../lib/numeric';
import { getDisplayStats } from '../../lib/statBenchmark';
import { renderBlurb } from '../../lib/renderBlurb';
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
  // Auto-expand one random row on mount
  const randomInitialRow = useMemo(
    () => picks.length > 0 ? picks[Math.floor(Math.random() * picks.length)].roundNumber : null,
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [expandedRound, setExpandedRound] = useState<number | null>(randomInitialRow);

  const pctOfPerfect = perfectTotal > 0 ? Math.round((yourTotal / perfectTotal) * 100) : 0;

  // Match picks to perfect by roundNumber, sorted in canonical position order
  const matchups = [...picks]
    .sort((a, b) => POSITIONS.indexOf(a.position as any) - POSITIONS.indexOf(b.position as any))
    .map(pick => {
      const perfect = perfectPicks.find(p => p.roundNumber === pick.roundNumber);
      const isMatch = perfect && pick.playerName === perfect.playerName && pick.year === perfect.year;
      return { pick, perfect, isMatch };
    });

  return (
    <div className="paper-card overflow-hidden">
      {/* HUGE comparison header */}
      <div className="px-4 py-4 border-b border-navy/10">
        <div className="flex items-baseline justify-center gap-3 mb-1">
          <span className="font-editorial font-black text-4xl text-navy">{yourTotal.toFixed(1)}</span>
          <span className="font-mono text-sm text-muted">vs</span>
          <span className="font-editorial font-black text-4xl text-navy">{perfectTotal.toFixed(1)}</span>
        </div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted">Your Lineup</p>
          <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted">Perfect</p>
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

          return (
            <div key={pick.roundNumber}>
              {/* Compact row — CSS Grid for alignment */}
              <button
                onClick={() => setExpandedRound(isExpanded ? null : pick.roundNumber)}
                className="w-full grid grid-cols-[32px_1fr_auto_1fr_20px] items-center px-3 py-2 text-left hover:bg-navy/3 transition-colors min-h-[44px]"
              >
                <span className="font-mono text-[10px] font-bold text-muted">
                  {pick.position}
                </span>
                <div className="flex items-center gap-1 justify-start min-w-0">
                  <span className={cn(
                    'text-xs truncate',
                    pick.wasTimeout && 'line-through text-muted',
                  )}>
                    {pick.playerName.split(' ').pop()} '{String(pick.year).slice(2)}
                  </span>
                  <span className={cn(
                    'font-mono text-[11px] font-bold flex-shrink-0 bg-paper px-1.5 py-0.5 rounded',
                    yourScore >= 9.5 ? 'text-gold' : yourScore >= 6.0 ? 'text-navy' : 'text-muted',
                  )}>
                    {yourScore.toFixed(1)}
                  </span>
                </div>
                <span className="text-muted/30 mx-1.5 flex-shrink-0">│</span>
                <div className="flex items-center gap-1 justify-end min-w-0">
                  <span className={cn(
                    'font-mono text-[11px] font-bold flex-shrink-0 bg-paper px-1.5 py-0.5 rounded',
                    perfectScore >= 9.5 ? 'text-gold' : 'text-navy',
                  )}>
                    {perfectScore.toFixed(1)}
                  </span>
                  <span className="text-xs text-navy truncate text-right">
                    {perfect?.playerName.split(' ').pop()} '{String(perfect?.year ?? 0).slice(2)}
                  </span>
                </div>
                {isMatch ? (
                  <Check size={12} className="text-[#2E7D32] flex-shrink-0 justify-self-end" />
                ) : (
                  <span className="w-3" />
                )}
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
            {isMatch && <Check size={12} className="inline ml-1 text-[#2E7D32]" />}
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
        <div className="bg-[#ECE9E0] rounded p-2 border border-navy/8">
          <p className="text-base text-navy/70 font-editorial italic leading-snug text-left">
            "{renderBlurb(perfect.blurb)}"
          </p>
        </div>
      )}
    </div>
  );
}
