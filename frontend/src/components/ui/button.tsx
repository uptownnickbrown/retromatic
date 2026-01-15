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
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sepia focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          // Variants
          variant === 'default' && "bg-sepia text-cream hover:bg-sepia/90",
          variant === 'secondary' && "bg-cardboard text-pinstripe hover:bg-cardboard/80",
          variant === 'outline' && "border-2 border-sepia bg-transparent hover:bg-cardboard/20",
          variant === 'ghost' && "hover:bg-cardboard/20 hover:text-sepia",
          variant === 'link' && "text-sepia underline-offset-4 hover:underline",
          // Sizes
          size === 'default' && "h-10 px-4 py-2",
          size === 'sm' && "h-9 rounded-md px-3",
          size === 'lg' && "h-11 rounded-md px-8",
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
