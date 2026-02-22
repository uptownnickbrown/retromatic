import { useMemo } from 'react';
import { cn } from '../../lib/utils';

interface PostmarkDateProps {
  date: string;
  className?: string;
}

export function PostmarkDate({ date, className }: PostmarkDateProps) {
  const formatted = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).toUpperCase();

  const rotation = useMemo(() => -3 - Math.random() * 4, []);

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <img
        src="/postmark.webp"
        alt=""
        className="w-36 h-auto opacity-80"
        style={{ mixBlendMode: 'multiply' }}
      />
      <span
        className="absolute font-mono text-[10px] font-bold tracking-wider text-navy-light"
        style={{ mixBlendMode: 'multiply' }}
      >
        {formatted}
      </span>
    </div>
  );
}
