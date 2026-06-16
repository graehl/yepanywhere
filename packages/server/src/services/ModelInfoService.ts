/**
 * Centralized cache for model metadata (especially context window sizes).
 *
 * Providers fetch model info from various sources (Ollama /api/show, SDK probes, etc.)
 * but that data was previously stranded in getAvailableModels() calls. This service
 * caches it so readers and routes can look up context windows without re-fetching.
 *
 * Sync getContextWindow() checks cache first, falls back to the shared heuristic.
 */

import {
  type ModelInfo,
  type ProviderName,
  getModelContextWindow,
} from "@yep-anywhere/shared";
import { getProvider } from "../sdk/providers/index.js";

export class ModelInfoService {
  /** (provider:modelId) → contextWindow */
  private contextWindows = new Map<string, number>();

  /**
   * Get context window for a model (sync).
   * Checks cache first, falls back to shared heuristic.
   */
  getContextWindow(model: string | undefined, provider?: ProviderName): number {
    if (model && provider) {
      // Provider-owned window quirks first (e.g. Claude opus is always-1M even
      // when its id resolves to "claude-opus-4-8", which the alias-keyed cache
      // below would miss). See topics/provider-abstraction.md.
      const fromProvider = getProvider(provider)?.contextWindowFor?.(model);
      if (fromProvider !== undefined) return fromProvider;
      const cached = this.contextWindows.get(`${provider}:${model}`);
      if (cached !== undefined) return cached;
    }
    return getModelContextWindow(model, provider);
  }

  /**
   * Populate cache from a provider's getAvailableModels().
   * Call at startup and when sessions are created. Failures are logged, not thrown.
   */
  async warmProvider(providerName: ProviderName): Promise<void> {
    const provider = getProvider(providerName);
    if (!provider) return;

    try {
      const models = await provider.getAvailableModels();
      this.ingestModels(providerName, models);
    } catch {
      // Best-effort — fallback to heuristic
    }
  }

  /**
   * Ingest model list into the cache.
   * Called by warmProvider() and also by the providers route when it already
   * has fresh model data (avoids redundant fetches).
   */
  ingestModels(providerName: ProviderName, models: ModelInfo[]): void {
    for (const m of models) {
      if (m.contextWindow) {
        this.contextWindows.set(`${providerName}:${m.id}`, m.contextWindow);
      }
    }
  }

  /**
   * Record a context window discovered at runtime
   * (e.g. from model_context_window in Codex app-server/session messages).
   */
  recordContextWindow(
    model: string,
    contextWindow: number,
    provider?: ProviderName,
  ): void {
    const key = provider ? `${provider}:${model}` : model;
    this.contextWindows.set(key, contextWindow);
  }
}
