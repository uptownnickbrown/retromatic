import { cn } from '../../lib/utils';

interface VintageButtonProps {
  children: React.ReactNode;
  variant: 'ticket' | 'section' | 'ghost';
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
}

export function VintageButton({
  children,
  variant,
  onClick,
  className,
  disabled,
  type = 'button',
}: VintageButtonProps) {
  const base = variant === 'ticket'
    ? 'btn-ticket'
    : variant === 'section'
      ? 'btn-section'
      : 'btn-ghost';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        base,
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
    >
      {children}
    </button>
  );
}
