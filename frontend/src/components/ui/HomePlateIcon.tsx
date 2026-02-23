interface HomePlateIconProps {
  className?: string;
}

/** Baseball home plate outline (pentagon shape) */
export function HomePlateIcon({ className }: HomePlateIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Pentagon: flat top, pointed bottom */}
      <polygon points="4,4 20,4 20,14 12,22 4,14" />
    </svg>
  );
}
