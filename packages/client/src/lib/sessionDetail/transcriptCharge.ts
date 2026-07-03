import type { SessionDetailState } from "./types";

/**
 * Approximate memory charges for session detail retention.
 *
 * Charges are relative weights, not exact heap sizes: a thinking-heavy
 * assistant row should cost proportionally more than a one-line user
 * prompt. Each object is measured once by JSON length (doubled for
 * UTF-16 string storage, plus per-row overhead) and memoized by object
 * identity, so unchanged rows are never re-serialized and an object
 * referenced from several entries is measured once.
 *
 * Calibration (2026-07-03, 40 most recent local session transcripts,
 * JSON chars per message row): mean 3184, p50 1517, p90 6550;
 * thinking-bearing rows mean 6706, p50 3567; plain chat rows p50 302.
 * The former flat 2048-per-message constant undercounted the mean and
 * hid that >10x relative spread.
 */

const chargeByObject = new WeakMap<object, number>();

/** ~2x the calibrated mean measured row; used when a row is unmeasurable
 * or deliberately unmeasured (the in-flight streaming row). */
export const FALLBACK_MESSAGE_CHARGE_BYTES = 6_400;

const ROW_OVERHEAD_BYTES = 64;

function measureObject(value: object): number {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) {
      return FALLBACK_MESSAGE_CHARGE_BYTES;
    }
    return json.length * 2 + ROW_OVERHEAD_BYTES;
  } catch {
    return FALLBACK_MESSAGE_CHARGE_BYTES;
  }
}

/**
 * Charge for one row object, memoized by identity. `measureUncached: false`
 * returns the fallback for objects not yet measured instead of serializing
 * them — dispatch-time estimates use it so the growing streaming row is
 * never re-serialized per event.
 */
export function chargeOfObject(value: unknown, measureUncached = true): number {
  if (typeof value !== "object" || value === null) {
    return ROW_OVERHEAD_BYTES;
  }
  const cached = chargeByObject.get(value);
  if (cached !== undefined) {
    return cached;
  }
  if (!measureUncached) {
    return FALLBACK_MESSAGE_CHARGE_BYTES;
  }
  const charge = measureObject(value);
  chargeByObject.set(value, charge);
  return charge;
}

export interface EstimateStateBytesOptions {
  /**
   * Serialize rows that have no memoized charge yet. Boundary paths
   * (persisted load, snapshot write) pass true; per-action dispatch
   * estimates pass false to keep the hot path free of serialization.
   */
  measureUncached?: boolean;
  /**
   * Cross-entry identity dedupe: rows already in `seen` charge nothing.
   * Aggregate-usage sweeps pass one shared set across entries so a row
   * referenced by several entries (e.g. tail variants of one session)
   * is charged once.
   */
  seen?: Set<object>;
}

function chargeRow(
  row: unknown,
  measureUncached: boolean,
  seen: Set<object> | undefined,
): number {
  if (seen && typeof row === "object" && row !== null) {
    if (seen.has(row)) {
      return 0;
    }
    seen.add(row);
  }
  return chargeOfObject(row, measureUncached);
}

export function estimateSessionDetailStateBytes(
  state: SessionDetailState,
  options: EstimateStateBytesOptions = {},
): number {
  const measureUncached = options.measureUncached ?? true;
  const seen = options.seen;
  let total = 0;
  for (const message of state.messages) {
    total += chargeRow(message, measureUncached, seen);
  }
  for (const agent of Object.values(state.agentContent)) {
    total += ROW_OVERHEAD_BYTES;
    for (const message of agent.messages) {
      total += chargeRow(message, measureUncached, seen);
    }
  }
  for (const augment of Object.values(state.markdownAugments)) {
    total += chargeRow(augment, measureUncached, seen);
  }
  for (const [toolUseId, agentId] of state.toolUseToAgentEntries) {
    total += (toolUseId.length + agentId.length) * 2 + ROW_OVERHEAD_BYTES;
  }
  return total;
}
