import type {
  Provider,
  ProviderCapabilities,
  ProviderMetadata,
} from "../types";

export class ClaudeOllamaProvider implements Provider {
  readonly id = "claude-ollama";
  readonly displayName = "Claude + Ollama";

  readonly capabilities: ProviderCapabilities = {
    supportsDag: true,
    supportsCloning: true,
    needsApproxMessageDedup: false,
    // Same Claude CLI persistence as ClaudeProvider: busy-path sends become
    // uuid-less queue-operation rows (topics/stream-durable-id-dedup.md).
    dedupQueueOperationEchoes: true,
  };

  readonly metadata: ProviderMetadata = {
    description:
      "Claude SDK agent loop with local Ollama models. Full tool calling, permissions, and session persistence.",
    limitations: [
      "Model quality varies by model",
      "No token counting",
      "Requires Ollama 0.14+",
    ],
    website: "https://ollama.com",
    cliName: "ollama",
  };
}
