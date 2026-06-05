/**
 * Compose-time context anchors for queued (deferred) message delivery.
 *
 * When a user message is queued while the agent is busy and delivered later,
 * the agent benefits from knowing how stale the message is relative to the work
 * it just did. At delivery (send) time — never at queue time — the first
 * delivered chunk is prefixed with `(Ns ago)` (whole seconds from composition to
 * delivery) and each later chunk with `(Ms later)` (whole seconds after the
 * previous chunk was composed). Anchors below {@link MIN_COMPOSE_ANCHOR_SECONDS}
 * are omitted as noise — a freshly delivered message needs no staleness note.
 *
 * This mirrors the harness "Queued-send time separators" convention so the agent
 * reads queued staleness the same way regardless of which supervisor delivered
 * the turn. Units are whole seconds to match that convention. See
 * topics/compose-time-context-anchors.md.
 */

/** Below this many seconds, a compose-time anchor is omitted as noise. */
export const MIN_COMPOSE_ANCHOR_SECONDS = 10;

/**
 * Anchor text for one delivered chunk, or null when below threshold or when a
 * timestamp is unusable (NaN). The first chunk anchors against delivery time;
 * a later chunk anchors against the previous chunk's compose time.
 *
 * @param composedAtMs server-clock epoch ms this chunk was composed/queued
 * @param deliveredAtMs server-clock epoch ms of delivery (computed at send time)
 * @param previousComposedAtMs prior chunk's compose time, or null for the first
 */
export function composeTimeAnchor(
  composedAtMs: number,
  deliveredAtMs: number,
  previousComposedAtMs: number | null,
): string | null {
  if (previousComposedAtMs === null) {
    const seconds = Math.round((deliveredAtMs - composedAtMs) / 1000);
    if (!Number.isFinite(seconds) || seconds < MIN_COMPOSE_ANCHOR_SECONDS) {
      return null;
    }
    return `(${seconds}s ago)`;
  }
  const seconds = Math.round((composedAtMs - previousComposedAtMs) / 1000);
  if (!Number.isFinite(seconds) || seconds < MIN_COMPOSE_ANCHOR_SECONDS) {
    return null;
  }
  return `(${seconds}s later)`;
}

/**
 * Anchors for an ordered batch of chunks delivered together at `deliveredAtMs`.
 * Returns one entry per chunk (string or null), preserving order. The first
 * chunk anchors against delivery time; each later chunk against the previous
 * chunk's compose time.
 */
export function composeTimeAnchors(
  composedAtMsList: number[],
  deliveredAtMs: number,
): (string | null)[] {
  return composedAtMsList.map((composedAtMs, index) =>
    composeTimeAnchor(
      composedAtMs,
      deliveredAtMs,
      index === 0 ? null : composedAtMsList[index - 1]!,
    ),
  );
}
