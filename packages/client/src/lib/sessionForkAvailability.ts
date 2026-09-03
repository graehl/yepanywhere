import {
  CODEX_PAGINATED_ROLLOUT_LINEAGE_CAPABILITY,
  SESSION_FORK_TURN_INTENTS_CAPABILITY,
  type ServerCapabilitySource,
  serverHasCapability,
} from "@yep-anywhere/shared";

export type SessionForkUnavailableReason =
  | "provider-unsupported"
  | "server-missing-fork-intents"
  | "server-missing-codex-lineage";

export type SessionForkAvailability =
  | { available: true }
  | { available: false; reason: SessionForkUnavailableReason };

function isCodexProvider(provider: string | null | undefined): boolean {
  return provider === "codex" || provider === "codex-oss";
}

/**
 * Explain whether unified Clone/direct Fork is safe against this provider and
 * server contract. Callers use the reason to distinguish hidden unsupported
 * providers from an updateable Codex server compatibility boundary.
 */
export function getUnifiedSessionForkAvailability(
  version: ServerCapabilitySource | null | undefined,
  providerSupportsFork: boolean | null | undefined,
  provider: string | null | undefined,
): SessionForkAvailability {
  if (providerSupportsFork !== true) {
    return { available: false, reason: "provider-unsupported" };
  }
  if (!serverHasCapability(version, SESSION_FORK_TURN_INTENTS_CAPABILITY)) {
    return { available: false, reason: "server-missing-fork-intents" };
  }
  if (
    isCodexProvider(provider) &&
    !serverHasCapability(version, CODEX_PAGINATED_ROLLOUT_LINEAGE_CAPABILITY)
  ) {
    return { available: false, reason: "server-missing-codex-lineage" };
  }
  return { available: true };
}

/**
 * Unified Clone/direct Fork is optional and must make no request to an older
 * server or a provider without a real transcript-fork primitive.
 */
export function supportsUnifiedSessionFork(
  version: ServerCapabilitySource | null | undefined,
  providerSupportsFork: boolean | null | undefined,
  provider?: string | null,
): boolean {
  return getUnifiedSessionForkAvailability(
    version,
    providerSupportsFork,
    provider,
  ).available;
}
