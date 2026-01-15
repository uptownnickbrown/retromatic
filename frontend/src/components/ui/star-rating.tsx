import * as React from "react";
import { cn } from "../../lib/utils";
import { getStarLabel } from "../../lib/utils";

interface StarRatingProps {
  rating: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function StarRating({ rating, showLabel = false, size = 'md', className }: StarRatingProps) {
  const stars = Array.from({ length: 5 }, (_, i) => i < rating);

  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <div className="flex">
        {stars.map((filled, i) => (
          <svg
            key={i}
            className={cn(
              sizeClasses[size],
              filled ? "text-gold" : "text-cardboard"
            )}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
      </div>
      {showLabel && (
        <span className={cn(
          "font-body",
          size === 'sm' && "text-xs",
          size === 'md' && "text-sm",
          size === 'lg' && "text-base",
          "text-dirt"
        )}>
          {getStarLabel(rating)}
        </span>
      )}
    </div>
  );
}
