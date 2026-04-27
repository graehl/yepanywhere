import { DummyBackend } from "./dummyBackend.js";
import type { SpeechBackend, SpeechBackendInfo } from "./SpeechBackend.js";

/**
 * Server-side registry of speech backends.
 *
 * On startup, the registry is asked to validate each candidate
 * backend; only those that pass are advertised to clients via the
 * `voiceBackends` field on the version response. The registry
 * itself does not transcribe audio — Phase 1 of the rollout uses it
 * purely for capability advertisement. Audio routing lands when the
 * first real backend (Deepgram) is plumbed through a WebSocket
 * handler.
 */
export class SpeechBackendRegistry {
  private readonly entries = new Map<string, SpeechBackendInfo>();

  /** Currently enabled backend ids in insertion order. */
  enabledIds(): string[] {
    return [...this.entries.values()]
      .filter((info) => info.enabled)
      .map((info) => info.id);
  }

  /** All known backends, including disabled ones, for diagnostics. */
  allInfo(): SpeechBackendInfo[] {
    return [...this.entries.values()];
  }

  /** True when the given id is currently enabled. */
  isEnabled(id: string): boolean {
    return this.entries.get(id)?.enabled ?? false;
  }

  async register(backend: SpeechBackend): Promise<void> {
    const result = await backend.validate();
    const info: SpeechBackendInfo = {
      id: backend.id,
      label: backend.label,
      enabled: result.ok,
      disabledReason: result.ok ? undefined : result.reason,
    };
    this.entries.set(backend.id, info);
  }
}

export interface SpeechRegistryInitOptions {
  /** Master switch — when false, no backends are registered. */
  voiceInputEnabled?: boolean;
  /** Explicitly requested backend ids. Empty means no server-routed speech. */
  voiceBackends?: string[];
}

/**
 * Construct and populate a registry based on server config. Real
 * backends (Deepgram, Whisper) will be added here in later phases,
 * each gated on credential validation.
 */
export async function initSpeechBackendRegistry(
  options: SpeechRegistryInitOptions = {},
): Promise<SpeechBackendRegistry> {
  const registry = new SpeechBackendRegistry();
  if (options.voiceInputEnabled === false) {
    return registry;
  }
  for (const backendId of options.voiceBackends ?? []) {
    switch (backendId) {
      case "ya-dummy":
        await registry.register(new DummyBackend());
        break;
      default:
        console.warn(`[Voice] Unknown speech backend requested: ${backendId}`);
    }
  }
  return registry;
}
