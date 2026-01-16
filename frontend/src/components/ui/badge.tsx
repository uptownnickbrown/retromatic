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
        variant === 'default' && "bg-gold text-navy",
        variant === 'secondary' && "bg-navy-light text-cream border border-cream/20",
        variant === 'outline' && "border border-gold text-gold bg-transparent",
        variant === 'success' && "bg-grass text-chalk",
        variant === 'warning' && "bg-red text-chalk",
        className
      )}
      {...props}
    />
  );
}

export { Badge };
