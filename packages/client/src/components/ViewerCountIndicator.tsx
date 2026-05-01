interface ViewerCountIndicatorProps {
  className?: string;
  count: number;
  label: string;
}

export function ViewerCountIndicator({
  className,
  count,
  label,
}: ViewerCountIndicatorProps) {
  return (
    <span
      className={`viewer-count-indicator${className ? ` ${className}` : ""}`}
      title={label}
      aria-label={label}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="viewer-count-indicator-icon"
      >
        <path d="M4 10a8 8 0 0 1 16 0" />
        <path d="M8 10a4 4 0 0 1 8 0" />
        <path d="M12 10v8" />
        <path d="M9 18h6" />
      </svg>
      <span>{count}</span>
    </span>
  );
}
