import { getLogger } from "../../logging/logger.js";
import { DeepgramBackend } from "./deepgramBackend.js";
import { DummyBackend } from "./dummyBackend.js";
import { LocalWhisperBackend } from "./localWhisperBackend.js";
import type { SpeechBackend, SpeechBackendInfo } from "./SpeechBackend.js";

const logger = getLogger();

/**
 * Server-side registry of speech backends.
 *
 * On startup, each candidate backend is validated; only those that pass are
 * advertised to clients via `voiceBackends` on the version response. The
 * registry also serves as the dispatch table for the audio WebSocket route.
 */
export class SpeechBackendRegistry {
  private readonly entries = new Map<
    string,
    { info: SpeechBackendInfo; backend: SpeechBackend }
  >();

  /** Currently enabled backend ids in insertion order. */
  enabledIds(): string[] {
    return [...this.entries.values()]
      .filter(({ info }) => info.enabled)
      .map(({ info }) => info.id);
  }

  /** All known backends, including disabled ones, for diagnostics. */
  allInfo(): SpeechBackendInfo[] {
    return [...this.entries.values()].map(({ info }) => info);
  }

  /** True when the given id is currently enabled. */
  isEnabled(id: string): boolean {
    return this.entries.get(id)?.info.enabled ?? false;
  }

  /** Return an enabled backend by id, or null if unknown/disabled. */
  getBackend(id: string): SpeechBackend | null {
    const entry = this.entries.get(id);
    if (!entry?.info.enabled) return null;
    return entry.backend;
  }

  async register(backend: SpeechBackend): Promise<void> {
    const result = await backend.validate();
    const info: SpeechBackendInfo = {
      id: backend.id,
      label: backend.label,
      enabled: result.ok,
      disabledReason: result.ok ? undefined : result.reason,
    };
    this.entries.set(backend.id, { info, backend });
    if (!result.ok) {
      logger.warn(`[Voice] Backend "${backend.id}" disabled: ${result.reason}`);
    } else {
      logger.info(`[Voice] Backend "${backend.id}" enabled`);
    }
  }
}

export interface SpeechRegistryInitOptions {
  /** Master switch — when false, no backends are registered. */
  voiceInputEnabled?: boolean;
  /** Explicitly requested backend ids. Empty means no server-routed speech. */
  voiceBackends?: string[];
  /** DEEPGRAM_API_KEY env value. */
  deepgramApiKey?: string;
  /** Whisper model name (default: distil-large-v3). */
  whisperModel?: string;
  /** Whisper device (default: cpu). */
  whisperDevice?: string;
  /** Whisper compute type (default: int8). */
  whisperComputeType?: string;
}

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

      case "ya-deepgram": {
        const key = options.deepgramApiKey ?? process.env.DEEPGRAM_API_KEY ?? "";
        if (!key) {
          logger.warn(
            '[Voice] ya-deepgram requested but DEEPGRAM_API_KEY is not set',
          );
        } else {
          await registry.register(new DeepgramBackend(key));
        }
        break;
      }

      case "ya-whisper":
        await registry.register(
          new LocalWhisperBackend({
            model: options.whisperModel,
            device: options.whisperDevice,
            computeType: options.whisperComputeType,
          }),
        );
        break;

      default:
        logger.warn(`[Voice] Unknown speech backend requested: ${backendId}`);
    }
  }

  return registry;
}
