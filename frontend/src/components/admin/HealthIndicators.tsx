import { cn } from '../../lib/utils';
import type { ChallengeHealth } from '../../lib/adminApi';

interface HealthIndicatorsProps {
  health: ChallengeHealth;
  compact?: boolean;
}

export function HealthIndicators({ health, compact }: HealthIndicatorsProps) {
  return (
    <div className={cn('flex items-center', compact ? 'gap-2' : 'gap-3')}>
      <Indicator
        label="Rounds"
        ready={health.roundsReady}
        detail={`${health.rounds}/10`}
        compact={compact}
      />
      <Indicator
        label="Blurbs"
        ready={health.blurbsReady}
        detail={health.blurbsMissing > 0 ? `${health.blurbsMissing} missing` : 'Ready'}
        compact={compact}
      />
      <Indicator
        label="Portraits"
        ready={health.portraitsReady}
        detail={health.portraitsMissing > 0 ? `${health.portraitsMissing} missing` : 'Ready'}
        compact={compact}
      />
    </div>
  );
}

function Indicator({ label, ready, detail, compact }: {
  label: string;
  ready: boolean;
  detail: string;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-1" title={`${label}: ${detail}`}>
      <div className={cn(
        'rounded-full flex-shrink-0',
        compact ? 'w-1.5 h-1.5' : 'w-2 h-2',
        ready ? 'bg-emerald-500' : 'bg-red-400',
      )} />
      {!compact && (
        <span className="font-mono text-[10px] text-muted">{label}</span>
      )}
    </div>
  );
}
