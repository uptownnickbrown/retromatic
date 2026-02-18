import { cn } from '../../lib/utils';

interface WaxSealProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
  className?: string;
}

const sizes = {
  sm: 'w-10 h-10',
  md: 'w-16 h-16',
  lg: 'w-[120px] h-[120px]',
};

export function WaxSeal({ score, size = 'md', animate = false, className }: WaxSealProps) {
  if (score < 9.5) return null;

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <img
        src="/wax-seal.png"
        alt="Legendary"
        className={cn(
          sizes[size],
          animate && 'wax-seal-stamp',
        )}
      />
      <span
        className={cn(
          'absolute font-editorial font-black text-white leading-none translate-y-[0.1em] drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)]',
          size === 'sm' && 'text-[10px]',
          size === 'md' && 'text-sm',
          size === 'lg' && 'text-2xl',
        )}
      >
        {score.toFixed(1)}
      </span>
    </div>
  );
}
