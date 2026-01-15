import * as React from "react";
import { cn } from "../../lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
        variant === 'default' && "bg-sepia text-cream",
        variant === 'secondary' && "bg-cardboard text-pinstripe",
        variant === 'outline' && "border border-sepia text-sepia bg-transparent",
        variant === 'success' && "bg-grass text-chalk",
        variant === 'warning' && "bg-gold text-pinstripe",
        className
      )}
      {...props}
    />
  );
}

export { Badge };
