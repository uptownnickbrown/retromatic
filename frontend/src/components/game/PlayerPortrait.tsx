import { cn } from '../../lib/utils';

interface PlayerPortraitProps {
  name: string;
  portraitUrl: string | null;
  position?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const positionColors: Record<string, string> = {
  C: 'from-blue-600 to-blue-800',
  '1B': 'from-red-600 to-red-800',
  '2B': 'from-green-600 to-green-800',
  SS: 'from-purple-600 to-purple-800',
  '3B': 'from-orange-600 to-orange-800',
  OF: 'from-teal-600 to-teal-800',
  UTIL: 'from-pink-600 to-pink-800',
  SP: 'from-indigo-600 to-indigo-800',
  RP: 'from-amber-600 to-amber-800',
  P: 'from-cyan-600 to-cyan-800',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function PlayerPortrait({ name, portraitUrl, position, size = 'md', className }: PlayerPortraitProps) {
  const sizeClasses = {
    sm: 'w-10 h-10 text-xs',
    md: 'w-14 h-14 text-sm',
    lg: 'w-20 h-20 text-lg',
  };

  const gradient = position ? positionColors[position] || 'from-slate-600 to-slate-800' : 'from-slate-600 to-slate-800';

  if (portraitUrl) {
    return (
      <div className={cn('relative rounded-full overflow-hidden flex-shrink-0', sizeClasses[size], className)}>
        <img src={portraitUrl} alt={name} className="w-full h-full object-cover" />
        {position && (
          <div className="absolute bottom-0 right-0 bg-navy text-[9px] font-bold text-cream px-1 rounded-tl">
            {position}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative rounded-full flex-shrink-0 flex items-center justify-center font-bold text-white bg-gradient-to-br',
        gradient,
        sizeClasses[size],
        className,
      )}
    >
      {getInitials(name)}
      {position && (
        <div className="absolute -bottom-0.5 -right-0.5 bg-navy text-[9px] font-bold text-cream px-1 rounded-full border border-navy">
          {position}
        </div>
      )}
    </div>
  );
}
