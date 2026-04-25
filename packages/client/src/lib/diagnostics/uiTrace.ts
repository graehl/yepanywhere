import { getRemoteLogCollectionEnabled } from "../../hooks/useDeveloperMode";

type TraceDetails = Record<string, unknown>;

function safeStringify(details: TraceDetails): string {
  try {
    return JSON.stringify(details);
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

export function logSessionUiTrace(
  event: string,
  details: TraceDetails = {},
): void {
  if (!getRemoteLogCollectionEnabled()) return;
  console.log(
    "[SessionUITrace]",
    safeStringify({
      event,
      ...details,
    }),
  );
}
