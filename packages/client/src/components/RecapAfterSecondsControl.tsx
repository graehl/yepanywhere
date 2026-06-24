import {
  DEFAULT_RECAP_AFTER_SECONDS,
  MAX_RECAP_AFTER_SECONDS,
  MIN_RECAP_AFTER_SECONDS,
  normalizeRecapAfterSeconds,
} from "@yep-anywhere/shared";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useI18n } from "../i18n";

interface RecapAfterSecondsControlProps {
  value?: number;
  disabled?: boolean;
  className?: string;
  onCommit: (value: number) => void | Promise<void>;
}

export function RecapAfterSecondsControl({
  value,
  disabled,
  className,
  onCommit,
}: RecapAfterSecondsControlProps) {
  const { t } = useI18n();
  const normalizedValue = useMemo(
    () => normalizeRecapAfterSeconds(value ?? DEFAULT_RECAP_AFTER_SECONDS),
    [value],
  );
  const [draft, setDraft] = useState(String(normalizedValue));

  useEffect(() => {
    setDraft(String(normalizedValue));
  }, [normalizedValue]);

  const commit = () => {
    const next = normalizeRecapAfterSeconds(Number(draft));
    setDraft(String(next));
    if (next !== normalizedValue) {
      void onCommit(next);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setDraft(String(normalizedValue));
      event.currentTarget.blur();
    }
  };

  return (
    <label
      className={
        className
          ? `recap-after-seconds-control ${className}`
          : "recap-after-seconds-control"
      }
    >
      <span>{t("recapAfterSecondsLabel")}</span>
      <input
        type="number"
        min={MIN_RECAP_AFTER_SECONDS}
        max={MAX_RECAP_AFTER_SECONDS}
        step={1}
        value={draft}
        disabled={disabled}
        aria-label={t("recapAfterSecondsAria")}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
      <span>{t("recapAfterSecondsUnit")}</span>
    </label>
  );
}
