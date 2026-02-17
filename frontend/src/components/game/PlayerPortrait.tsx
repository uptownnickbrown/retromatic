import { cn } from '../../lib/utils';

interface PlayerPortraitProps {
  name: string;
  portraitUrl: string | null;
  position?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'w-10 h-12',
  md: 'w-14 h-[70px]',
  lg: 'w-20 h-24',
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
        <img src={portraitUrl} alt={name} className="w-full h-full object-cover" />
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
      <span className="font-editorial font-black text-3xl text-navy/15 select-none leading-none">
        {initials}
      </span>
    </div>
  );
}
