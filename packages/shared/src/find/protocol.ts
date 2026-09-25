/**
 * Messages between a YA viewer and the find agent the artifact server adds to
 * framed HTML. The parent only ever learns match counts and, when the reader
 * presses Ctrl+F, the text they had selected in the frame; the agent only
 * accepts requests from its own parent window.
 */
import type { FindCounts } from "./documentFind.js";

export const FIND_PROTOCOL = "yep-find/1";

export type FindRequest =
  | { protocol: typeof FIND_PROTOCOL; type: "hello" }
  | { protocol: typeof FIND_PROTOCOL; type: "find"; seq: number; query: string }
  | {
      protocol: typeof FIND_PROTOCOL;
      type: "step";
      seq: number;
      direction: 1 | -1;
    }
  | { protocol: typeof FIND_PROTOCOL; type: "clear" };

export type FindReport =
  | { protocol: typeof FIND_PROTOCOL; type: "ready" }
  | ({
      protocol: typeof FIND_PROTOCOL;
      type: "result";
      seq: number;
    } & FindCounts)
  | { protocol: typeof FIND_PROTOCOL; type: "open"; selection: string }
  | {
      protocol: typeof FIND_PROTOCOL;
      type: "shortcut";
      direction: 1 | -1;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isFindRequest(value: unknown): value is FindRequest {
  if (!isRecord(value) || value.protocol !== FIND_PROTOCOL) return false;
  switch (value.type) {
    case "hello":
    case "clear":
      return true;
    case "find":
      return typeof value.seq === "number" && typeof value.query === "string";
    case "step":
      return (
        typeof value.seq === "number" &&
        (value.direction === 1 || value.direction === -1)
      );
    default:
      return false;
  }
}

export function isFindReport(value: unknown): value is FindReport {
  if (!isRecord(value) || value.protocol !== FIND_PROTOCOL) return false;
  switch (value.type) {
    case "ready":
      return true;
    case "result":
      return (
        typeof value.seq === "number" &&
        typeof value.total === "number" &&
        typeof value.current === "number" &&
        typeof value.capped === "boolean"
      );
    case "open":
      return typeof value.selection === "string";
    case "shortcut":
      return value.direction === 1 || value.direction === -1;
    default:
      return false;
  }
}

/** Selected text worth seeding a search with: short and on one line. */
export function findSeed(selection: string | undefined): string {
  const text = selection?.trim() ?? "";
  return text && text.length <= 200 && !text.includes("\n") ? text : "";
}
