import { cn } from '../../lib/utils';

interface TimerProps {
  timeLeft: number;
  progress: number;
  isUrgent: boolean;
}

export function Timer({ timeLeft, progress, isUrgent }: TimerProps) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  const colorClass = isUrgent
    ? 'text-red stroke-red'
    : progress > 0.33
      ? 'text-gold stroke-gold'
      : 'text-gold-light stroke-gold-light';

  return (
    <div className={cn('relative flex items-center justify-center', isUrgent && 'animate-pulse')}>
      <svg width="56" height="56" viewBox="0 0 48 48" className="-rotate-90">
        <circle
          cx="24" cy="24" r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-navy-light opacity-40"
        />
        <circle
          cx="24" cy="24" r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={cn('transition-all duration-100', colorClass)}
        />
      </svg>
      <span className={cn(
        'absolute font-mono font-bold text-sm',
        isUrgent ? 'text-red' : 'text-cream',
      )}>
        {Math.ceil(timeLeft)}
      </span>
    </div>
  );
}
