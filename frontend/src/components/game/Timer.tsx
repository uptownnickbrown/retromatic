import { cn } from '../../lib/utils';

interface TimerProps {
  timeLeft: number;
  progress: number;
  isUrgent: boolean;
}

export function Timer({ timeLeft, progress, isUrgent }: TimerProps) {
  const seconds = Math.ceil(timeLeft);

  return (
    <div className={cn('flex items-center gap-2', isUrgent && 'urgent-shake')}>
      {/* Scoreboard-style timer */}
      <div
        className={cn(
          'scoreboard text-2xl min-w-[52px] text-center py-1 px-2',
          isUrgent && 'border-red-500',
        )}
        style={isUrgent ? {
          color: '#ff4444',
          textShadow: '0 0 12px rgba(255, 68, 68, 0.8)',
        } : undefined}
      >
        {seconds}
      </div>

      {/* Progress bar as a baseball bat filling */}
      <div className="flex-1 h-3 bg-black/40 rounded-full overflow-hidden border border-white/10 min-w-[60px]">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-100 ease-linear',
            isUrgent
              ? 'bg-gradient-to-r from-red-600 to-red-400'
              : progress > 0.5
                ? 'bg-gradient-to-r from-amber-600 to-amber-400'
                : 'bg-gradient-to-r from-amber-700 to-amber-500',
          )}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
