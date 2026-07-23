import { useTextTooltipAttributes } from "../../hooks/useTooltipAppearance";

interface HiddenContentBadgeProps {
  count: number;
  className?: string;
  tooltip: string;
}

/** Compact cue and shared tail reveal for a preview that omits content. */
export function HiddenContentBadge({
  count,
  className,
  tooltip,
}: HiddenContentBadgeProps) {
  const classes = className
    ? `hidden-content-badge ${className}`
    : "hidden-content-badge";
  const tooltipAttributes = useTextTooltipAttributes(tooltip);

  return (
    <span className={classes} {...tooltipAttributes}>
      +{count}
    </span>
  );
}
