import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { CommittedRangeInput } from "./CommittedRangeInput";

interface CommittedRangeNumberInputProps {
  id?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  unit?: ReactNode;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  onEdit?: () => void;
  onCommit: (value: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function CommittedRangeNumberInput({
  id,
  min,
  max,
  step = 1,
  value,
  unit,
  disabled,
  ariaLabel,
  className,
  onEdit,
  onCommit,
}: CommittedRangeNumberInputProps) {
  const [rangeValue, setRangeValue] = useState(value);
  const [textDraft, setTextDraft] = useState(String(value));

  useEffect(() => {
    setRangeValue(value);
    setTextDraft(String(value));
  }, [value]);

  const normalize = useCallback(
    (next: number) => {
      const stepped = min + Math.round((next - min) / step) * step;
      return clamp(stepped, min, max);
    },
    [max, min, step],
  );

  const resetDraft = useCallback(() => {
    setRangeValue(value);
    setTextDraft(String(value));
  }, [value]);

  const commit = useCallback(
    (next: number) => {
      const normalized = normalize(next);
      setRangeValue(normalized);
      setTextDraft(String(normalized));
      onCommit(normalized);
    },
    [normalize, onCommit],
  );

  const commitText = useCallback(() => {
    if (textDraft.trim() === "") {
      resetDraft();
      return;
    }
    const parsed = Number(textDraft);
    if (!Number.isFinite(parsed)) {
      resetDraft();
      return;
    }
    commit(parsed);
  }, [commit, resetDraft, textDraft]);

  const handleTextKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitText();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      resetDraft();
      event.currentTarget.blur();
    }
  };

  return (
    <span
      className={
        className
          ? `output-appearance-slider-row ${className}`
          : "output-appearance-slider-row"
      }
    >
      <CommittedRangeInput
        id={id}
        min={min}
        max={max}
        step={step}
        value={rangeValue}
        disabled={disabled}
        aria-label={ariaLabel}
        onDraftChange={(next) => {
          setTextDraft(String(next));
          onEdit?.();
        }}
        onCommit={commit}
      />
      <span className="output-appearance-number-wrap">
        <input
          id={id ? `${id}-number` : undefined}
          type="number"
          className="settings-input-small output-appearance-number"
          min={min}
          max={max}
          step={step}
          value={textDraft}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(event) => {
            const nextText = event.currentTarget.value;
            setTextDraft(nextText);
            if (nextText.trim() === "") return;
            const parsed = Number(nextText);
            if (!Number.isFinite(parsed)) return;
            setRangeValue(clamp(parsed, min, max));
            onEdit?.();
          }}
          onBlur={commitText}
          onKeyDown={handleTextKeyDown}
        />
        {unit && <span className="output-appearance-unit">{unit}</span>}
      </span>
    </span>
  );
}
