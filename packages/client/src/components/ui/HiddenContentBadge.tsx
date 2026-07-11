interface HiddenContentBadgeProps {
  count: number;
  className?: string;
}

/** Compact cue that a preview omits source content. */
export function HiddenContentBadge({
  count,
  className,
}: HiddenContentBadgeProps) {
  const classes = className
    ? `hidden-content-badge ${className}`
    : "hidden-content-badge";

  return <span className={classes}>+{count}</span>;
}
