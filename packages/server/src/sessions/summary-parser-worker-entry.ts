import type { SummaryParserWorkerRequest } from "./summary-parser-worker-protocol.js";
import { runSummaryParserWorkerRequest } from "./summary-parser-worker-runner.js";

function isParseRequest(value: unknown): value is SummaryParserWorkerRequest {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "parse" &&
    typeof (value as { requestId?: unknown }).requestId === "string"
  );
}

if (typeof process.send !== "function") {
  console.error("summary-parser-worker-entry requires fork IPC");
  process.exit(1);
}

process.on("disconnect", () => {
  process.exit(0);
});

process.on("message", (message: unknown) => {
  if (!isParseRequest(message)) {
    return;
  }

  void (async () => {
    const response = await runSummaryParserWorkerRequest(message);
    process.send?.(response);
  })();
});

process.send({
  type: "ready",
  pid: process.pid,
  nodeVersion: process.version,
});
