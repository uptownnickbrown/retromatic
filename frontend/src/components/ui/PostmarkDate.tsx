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

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <img
        src="/postmark.png"
        alt=""
        className="w-36 h-auto opacity-70"
      />
      <span className="absolute font-mono text-[10px] font-bold tracking-wider text-navy-light">
        {formatted}
      </span>
    </div>
  );
}
