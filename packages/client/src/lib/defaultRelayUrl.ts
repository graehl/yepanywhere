import { DEFAULT_RELAY_URL, normalizeRelayUrl } from "@yep-anywhere/shared";

/**
 * Resolve the hosted-client default relay URL.
 *
 * Upstream defaults stay on the public relay. Personal/static deployments can
 * set VITE_DEFAULT_RELAY_URL at build time without changing shared defaults.
 */
export function resolveDefaultRelayUrl(raw: string | undefined): string {
  if (!raw?.trim()) {
    return DEFAULT_RELAY_URL;
  }
  return normalizeRelayUrl(raw);
}

export function getDefaultRelayUrl(): string {
  try {
    return resolveDefaultRelayUrl(import.meta.env.VITE_DEFAULT_RELAY_URL);
  } catch (err) {
    console.warn(
      "[RemoteClient] Ignoring invalid VITE_DEFAULT_RELAY_URL:",
      err instanceof Error ? err.message : String(err),
    );
    return DEFAULT_RELAY_URL;
  }
}

/**
 * Resolve the relay URL a login should use: an explicit form/hash value wins,
 * then the username's saved host — so a re-login with the field left blank
 * keeps a previously customized relay instead of silently resetting the saved
 * host to the deployment default — then the deployment default.
 *
 * Throws (from normalizeRelayUrl) on an invalid explicit value.
 */
export function resolveLoginRelayUrl(
  input: string,
  savedRelayUrl: string | undefined,
): string {
  return normalizeRelayUrl(
    input.trim() || savedRelayUrl || getDefaultRelayUrl(),
  );
}
