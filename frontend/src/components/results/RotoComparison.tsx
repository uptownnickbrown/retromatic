import { cn } from '../../lib/utils';
import { computeRotoComparison } from '../../lib/rotoStats';
import type { ResultsPick, PerfectLineupPick } from '../../types';

interface RotoComparisonProps {
  leftPicks: (ResultsPick | PerfectLineupPick)[];
  rightPicks: (ResultsPick | PerfectLineupPick)[];
  leftLabel?: string;
  rightLabel?: string;
}

export function RotoComparison({
  leftPicks,
  rightPicks,
  leftLabel = 'Your Lineup',
  rightLabel = 'Perfect',
}: RotoComparisonProps) {
  const comparison = computeRotoComparison(leftPicks, rightPicks);

  if (comparison.batting.length === 0 && comparison.pitching.length === 0) {
    return null;
  }

  return (
    <div className="paper-card overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-navy/10">
        <p className="text-[10px] font-mono font-bold uppercase tracking-[0.15em] text-muted text-center">
          Season-Long Head to Head
        </p>
      </div>

      {/* Batting section */}
      {comparison.batting.length > 0 && (
        <div>
          <div className="grid grid-cols-[1fr_60px_60px_16px] items-center px-4 py-2 bg-navy/5">
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted">Batting</span>
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted text-right">{leftLabel}</span>
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted text-right">{rightLabel}</span>
            <span />
          </div>
          <div className="divide-y divide-navy/6">
            {comparison.batting.map(cat => (
              <div key={cat.key} className="grid grid-cols-[1fr_60px_60px_16px] items-center px-4 py-2">
                <span className="font-mono text-xs text-muted">{cat.label}</span>
                <span className={cn(
                  'font-mono text-xs tabular-nums text-right',
                  cat.winner === 'left' ? 'font-bold text-navy' : 'text-muted',
                )}>
                  {cat.yourValue}
                </span>
                <span className={cn(
                  'font-mono text-xs tabular-nums text-right',
                  cat.winner === 'right' ? 'font-bold text-navy' : 'text-muted',
                )}>
                  {cat.perfectValue}
                </span>
                <span className="text-center text-[10px]">
                  {cat.winner === 'left' ? '◀' : cat.winner === 'right' ? '▶' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pitching section */}
      {comparison.pitching.length > 0 && (
        <div>
          <div className="grid grid-cols-[1fr_60px_60px_16px] items-center px-4 py-2 bg-navy/5">
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted">Pitching</span>
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted text-right">{leftLabel}</span>
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted text-right">{rightLabel}</span>
            <span />
          </div>
          <div className="divide-y divide-navy/6">
            {comparison.pitching.map(cat => (
              <div key={cat.key} className="grid grid-cols-[1fr_60px_60px_16px] items-center px-4 py-2">
                <span className="font-mono text-xs text-muted">{cat.label}</span>
                <span className={cn(
                  'font-mono text-xs tabular-nums text-right',
                  cat.winner === 'left' ? 'font-bold text-navy' : 'text-muted',
                )}>
                  {cat.yourValue}
                </span>
                <span className={cn(
                  'font-mono text-xs tabular-nums text-right',
                  cat.winner === 'right' ? 'font-bold text-navy' : 'text-muted',
                )}>
                  {cat.perfectValue}
                </span>
                <span className="text-center text-[10px]">
                  {cat.winner === 'left' ? '◀' : cat.winner === 'right' ? '▶' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Final tally */}
      <div className="px-4 py-3 border-t border-navy/10 bg-bone/50">
        <div className="flex items-center justify-center gap-3">
          <span className={cn(
            'font-editorial font-bold text-xl',
            comparison.leftWins >= comparison.rightWins ? 'text-navy' : 'text-muted',
          )}>
            {leftLabel} {comparison.leftWins}
          </span>
          <span className="font-mono text-sm text-muted">—</span>
          <span className={cn(
            'font-editorial font-bold text-xl',
            comparison.rightWins >= comparison.leftWins ? 'text-navy' : 'text-muted',
          )}>
            {rightLabel} {comparison.rightWins}
          </span>
        </div>
        {comparison.ties > 0 && (
          <p className="text-center font-mono text-[10px] text-muted mt-1">
            {comparison.ties} tied
          </p>
        )}
      </div>
    </div>
  );
}
