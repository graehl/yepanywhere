import { getRemoteLogCollectionEnabled } from "../../hooks/useDeveloperMode";

type TraceDetails = Record<string, unknown>;

const HIGH_CHURN_TRACE_FLUSH_MS = 1_000;

interface HighChurnTraceBatch {
  timer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  total: number;
  counts: Record<string, number>;
  sessionId?: unknown;
  firstEventId?: unknown;
  lastEventId?: unknown;
}

let highChurnTraceBatch: HighChurnTraceBatch | null = null;

function safeStringify(details: TraceDetails): string {
  try {
    return JSON.stringify(details);
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

function getHighChurnTraceKey(
  event: string,
  details: TraceDetails,
): string | null {
  if (event !== "session-stream-event") return null;
  const eventType = details.eventType;
  const sdkType = details.sdkType;
  if (eventType === "message" && sdkType === "stream_event") {
    return "message:stream_event";
  }
  if (eventType === "pending" || eventType === "markdown-augment") {
    return String(eventType);
  }
  return null;
}

function flushHighChurnTraceBatch(): void {
  const batch = highChurnTraceBatch;
  if (!batch) return;
  highChurnTraceBatch = null;
  if (batch.timer) {
    clearTimeout(batch.timer);
  }
  console.log(
    "[SessionUITrace]",
    safeStringify({
      event: "session-stream-event-batch",
      sessionId: batch.sessionId,
      total: batch.total,
      counts: batch.counts,
      windowMs: Date.now() - batch.startedAt,
      firstEventId: batch.firstEventId ?? null,
      lastEventId: batch.lastEventId ?? null,
    }),
  );
}

function recordHighChurnTrace(key: string, details: TraceDetails): void {
  if (!highChurnTraceBatch) {
    highChurnTraceBatch = {
      timer: null,
      startedAt: Date.now(),
      total: 0,
      counts: {},
      sessionId: details.sessionId,
      firstEventId: details.eventId,
    };
    highChurnTraceBatch.timer = setTimeout(
      flushHighChurnTraceBatch,
      HIGH_CHURN_TRACE_FLUSH_MS,
    );
  }
  highChurnTraceBatch.total += 1;
  highChurnTraceBatch.counts[key] =
    (highChurnTraceBatch.counts[key] ?? 0) + 1;
  highChurnTraceBatch.lastEventId = details.eventId;
}

export function logSessionUiTrace(
  event: string,
  details: TraceDetails = {},
): void {
  if (!getRemoteLogCollectionEnabled()) return;
  const highChurnKey = getHighChurnTraceKey(event, details);
  if (highChurnKey) {
    recordHighChurnTrace(highChurnKey, details);
    return;
  }
  console.log(
    "[SessionUITrace]",
    safeStringify({
      event,
      ...details,
    }),
  );
}
