import { cn } from '../../lib/utils';

interface PlayerPortraitProps {
  name: string;
  portraitUrl: string | null;
  position?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

const sizeMap = {
  sm: 'w-12 h-14',
  md: 'w-14 h-[70px]',
  lg: 'w-20 h-24',
  xl: 'w-24 h-28',
  '2xl': 'w-32 h-[152px]',
};

export function PlayerPortrait({ name, portraitUrl, size = 'md', className }: PlayerPortraitProps) {
  if (portraitUrl) {
    return (
      <div
        className={cn(
          'relative flex-shrink-0 rounded overflow-hidden border border-navy/15 bg-paper',
          'shadow-[1px_1px_0px_rgba(10,30,47,0.1)]',
          sizeMap[size],
          className,
        )}
      >
        <img
          src={portraitUrl}
          alt={name}
          className="w-full h-full object-cover object-top"
        />
      </div>
    );
  }

  // Fallback: large Playfair initials
  const initials = name
    .split(' ')
    .map(w => w[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={cn(
        'relative flex-shrink-0 rounded overflow-hidden border border-navy/15 bg-bone',
        'shadow-[1px_1px_0px_rgba(10,30,47,0.1)]',
        'flex items-center justify-center',
        sizeMap[size],
        className,
      )}
    >
      <span className={cn(
        'font-editorial font-black text-navy/15 select-none leading-none',
        size === '2xl' ? 'text-5xl' : 'text-3xl',
      )}>
        {initials}
      </span>
    </div>
  );
}
