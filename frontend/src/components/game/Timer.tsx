import { cn } from '../../lib/utils';

interface TimerProps {
  timeLeft: number;
  progress: number;
  isUrgent: boolean;
}

export function Timer({ timeLeft, progress, isUrgent }: TimerProps) {
  const seconds = Math.ceil(timeLeft);

  return (
    <div className={cn('flex items-center gap-3', isUrgent && 'urgent-shake')}>
      {/* Seconds display */}
      <span
        className={cn(
          'font-editorial font-bold text-2xl min-w-[44px] text-right tabular-nums',
          isUrgent ? 'text-red' : 'text-navy',
        )}
      >
        {seconds}
      </span>

      {/* Ink-draining progress bar */}
      <div className="flex-1 h-1.5 bg-navy/10 rounded-full overflow-hidden min-w-[60px]">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-100 ease-linear',
            isUrgent ? 'bg-red' : 'bg-navy',
          )}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
