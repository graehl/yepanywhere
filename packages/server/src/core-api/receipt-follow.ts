import { createHash } from "node:crypto";
import { z } from "zod";
import { followQuery } from "./conversation.js";
import { receiptSchema, type ApiReceipt } from "./command-contracts.js";
import type { ApiReceiptStore } from "./receipt-store.js";
import { CoreApiError } from "./errors.js";
export const receiptFollowQuery = z
  .object({
    after: z
      .string()
      .regex(/^r1\.[a-f0-9]{64}$/)
      .optional()
      .describe(
        "Opaque cursor from this receipt's follow response. Foreign/stale cursors return current full receipt state.",
      ),
    waitMs: followQuery.shape.waitMs,
  })
  .strict();
export type ReceiptFollowQuery = z.infer<typeof receiptFollowQuery>;
export const receiptFollowSchema = z.object({
  cursor: z.string(),
  changed: z.boolean(),
  receipt: receiptSchema.nullable(),
});
export type ApiReceiptFollow = z.infer<typeof receiptFollowSchema>;
const cursor = (receipt: ApiReceipt) =>
  "r1." + createHash("sha256").update(JSON.stringify(receipt)).digest("hex");

/** Subscribe before reading, then hold at most one bounded response per request. */
export function followReceipt(
  store: ApiReceiptStore,
  id: string,
  query: ReceiptFollowQuery,
  signal: AbortSignal,
): Promise<ApiReceiptFollow> {
  return new Promise((resolve, reject) => {
    let release: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = (result?: ApiReceiptFollow, error?: unknown) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      release?.();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () =>
      finish(
        undefined,
        new CoreApiError(
          "controller_unavailable",
          "Receipt wait was cancelled or its owner closed",
          503,
        ),
      );
    let latest: ApiReceipt;
    const observe = (receipt: ApiReceipt) => {
      latest = receipt;
      const current = cursor(receipt);
      if (current !== query.after)
        finish({ cursor: current, changed: true, receipt });
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      release = store.subscribe(id, observe);
      const initial = store.get(id);
      if (!initial) {
        finish(
          undefined,
          new CoreApiError("receipt_not_found", "Receipt not found", 404),
        );
        return;
      }
      observe(initial);
      if (!done)
        timer = setTimeout(
          () =>
            finish({ cursor: cursor(latest), changed: false, receipt: null }),
          Number(query.waitMs ?? 4000),
        );
      if (done) release();
    } catch (error) {
      finish(undefined, error);
    }
  });
}
