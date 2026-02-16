import { cn } from '../../lib/utils';

interface PlayerPortraitProps {
  name: string;
  portraitUrl: string | null;
  position?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const positionColors: Record<string, { bg: string; accent: string }> = {
  C:    { bg: 'from-blue-700 to-blue-900', accent: 'bg-blue-600' },
  '1B': { bg: 'from-red-700 to-red-900', accent: 'bg-red-600' },
  '2B': { bg: 'from-emerald-700 to-emerald-900', accent: 'bg-emerald-600' },
  SS:   { bg: 'from-purple-700 to-purple-900', accent: 'bg-purple-600' },
  '3B': { bg: 'from-orange-700 to-orange-900', accent: 'bg-orange-600' },
  OF:   { bg: 'from-teal-700 to-teal-900', accent: 'bg-teal-600' },
  UTIL: { bg: 'from-pink-700 to-pink-900', accent: 'bg-pink-600' },
  SP:   { bg: 'from-indigo-700 to-indigo-900', accent: 'bg-indigo-600' },
  RP:   { bg: 'from-amber-700 to-amber-900', accent: 'bg-amber-600' },
  P:    { bg: 'from-cyan-700 to-cyan-900', accent: 'bg-cyan-600' },
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
    md: 'w-14 h-14 text-base',
    lg: 'w-20 h-20 text-xl',
  };

  const posStyle = position ? positionColors[position] || { bg: 'from-slate-700 to-slate-900', accent: 'bg-slate-600' } : { bg: 'from-slate-700 to-slate-900', accent: 'bg-slate-600' };

  if (portraitUrl) {
    return (
      <div className={cn(
        'relative flex-shrink-0 rounded-lg overflow-hidden border-2 border-cardboard-dark',
        sizeClasses[size],
        className,
      )}
        style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.3)' }}
      >
        <img src={portraitUrl} alt={name} className="w-full h-full object-cover" />
        {position && (
          <div className={cn(
            'absolute bottom-0 left-0 right-0 text-center text-[9px] font-heading text-white py-0.5',
            posStyle.accent,
          )}>
            {position}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative flex-shrink-0 rounded-lg flex flex-col items-center justify-center font-heading text-white bg-gradient-to-br border-2 border-cardboard-dark',
        posStyle.bg,
        sizeClasses[size],
        className,
      )}
      style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.3)' }}
    >
      <span className="leading-none">{getInitials(name)}</span>
      {position && (
        <div className={cn(
          'absolute bottom-0 left-0 right-0 text-center text-[8px] font-heading text-white/90 py-0.5 rounded-b',
          posStyle.accent,
        )}>
          {position}
        </div>
      )}
    </div>
  );
}
