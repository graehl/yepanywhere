import type {
  Provider,
  ProviderCapabilities,
  ProviderMetadata,
} from "../types";

export class ClaudeProvider implements Provider {
  readonly id = "claude";
  readonly displayName = "Claude";

  readonly capabilities: ProviderCapabilities = {
    supportsDag: true,
    supportsCloning: true,
    needsApproxMessageDedup: false,
    // Busy-path sends persist as uuid-less queue-operation rows; pair them
    // against the optimistic echoes (topics/stream-durable-id-dedup.md).
    dedupQueueOperationEchoes: true,
  };

  readonly metadata: ProviderMetadata = {
    description:
      "Anthropic's Claude Code SDK. Full tool transparency, real-time streaming, and permission modes.",
    limitations: [],
    website: "https://claude.ai/download",
    cliName: "claude",
  };
}
