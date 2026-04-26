import {
  formatAbsoluteTimestamp,
  formatCompactRelativeAge,
} from "../lib/messageAge";

interface Props {
  timestampMs: number | null | undefined;
  nowMs: number;
  className?: string;
  prefix?: string;
}

export function MessageAge({ timestampMs, nowMs, className, prefix }: Props) {
  if (timestampMs === null || timestampMs === undefined) {
    return null;
  }

  const date = new Date(timestampMs);
  const label = formatCompactRelativeAge(timestampMs, nowMs);
  const absolute = formatAbsoluteTimestamp(timestampMs);

  return (
    <time
      className={className ?? "message-age"}
      dateTime={date.toISOString()}
      title={absolute}
    >
      {prefix ? `${prefix} ${label}` : label}
    </time>
  );
}
