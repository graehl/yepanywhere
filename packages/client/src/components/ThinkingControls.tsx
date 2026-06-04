import type { EffortLevel, ThinkingMode } from "@yep-anywhere/shared";
import type { CSSProperties } from "react";
import type { EffortLevelOption } from "../lib/effortLevels";

export function ThinkingIcon({ mode }: { mode: ThinkingMode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
      {mode === "auto" && (
        <g>
          <circle cx="19" cy="5" r="5.5" fill="currentColor" stroke="none" />
          <text
            x="19"
            y="5"
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--bg-primary, #1a1a2e)"
            fontSize="8"
            fontWeight="700"
            fontFamily="system-ui, sans-serif"
            stroke="none"
          >
            A
          </text>
        </g>
      )}
    </svg>
  );
}

interface ThinkingEffortSelectorProps {
  options: readonly EffortLevelOption[];
  value: EffortLevel;
  onChange: (level: EffortLevel) => void;
  ariaLabel: string;
  disabled?: boolean;
  variant?: "toolbar" | "settings";
  className?: string;
}

export function ThinkingEffortSelector({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
  variant = "toolbar",
  className,
}: ThinkingEffortSelectorProps) {
  const optionCount = Math.max(1, options.length);
  const style = {
    "--thinking-effort-option-count": optionCount,
  } as CSSProperties;
  const classes = [
    "thinking-effort-selector",
    `thinking-effort-selector--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="group" aria-label={ariaLabel} style={style}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`thinking-effort-option ${
            value === option.value ? "active" : ""
          }`}
          onClick={() => onChange(option.value)}
          disabled={disabled}
          title={option.description}
          aria-label={`${ariaLabel}: ${option.label}`}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
