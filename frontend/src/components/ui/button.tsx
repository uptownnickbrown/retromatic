import * as React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy disabled:pointer-events-none disabled:opacity-50",
          // Variants
          variant === 'default' && "bg-gold text-navy hover:bg-gold-light shadow-lg shadow-gold/20",
          variant === 'secondary' && "bg-navy-light text-cream hover:bg-navy-light/80 border border-cream/20",
          variant === 'outline' && "border-2 border-current bg-transparent hover:bg-white/10",
          variant === 'ghost' && "hover:bg-white/10 text-cream",
          variant === 'link' && "text-gold underline-offset-4 hover:underline",
          // Sizes
          size === 'default' && "h-10 px-5 py-2",
          size === 'sm' && "h-9 rounded-md px-4 text-xs",
          size === 'lg' && "h-12 rounded-xl px-8 text-base",
          size === 'icon' && "h-10 w-10",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
