import { cn } from '../../lib/utils';

interface PaperCardProps {
  children: React.ReactNode;
  className?: string;
  elevated?: boolean;
  noPadding?: boolean;
}

export function PaperCard({ children, className, elevated, noPadding }: PaperCardProps) {
  return (
    <div
      className={cn(
        'paper-card',
        !noPadding && 'p-4',
        elevated && 'shadow-[3px_3px_0px_rgba(10,30,47,0.2)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
