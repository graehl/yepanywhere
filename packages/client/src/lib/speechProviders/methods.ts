/**
 * Speech-recognition methods exposed in the UI.
 *
 * `browser-native` is the client-side escape hatch. Every server-routed
 * method comes directly from `/api/version.voiceBackends`; the client must not
 * keep an independent whitelist of backend ids.
 */

import {
  detectBrowserNativeLabel,
  formatBrowserNativeLabel,
} from "./browserNativeLabel";
import type { GrokSpeechAudioSettings } from "./SpeechProvider";

export type SpeechMethodId = string;

export const DEFAULT_SPEECH_METHOD: SpeechMethodId = "browser-native";
export const XAI_DIRECT_STREAMING_SPEECH_METHOD: SpeechMethodId =
  "xai-grok-direct-streaming";
export const XAI_DIRECT_BATCH_SPEECH_METHOD: SpeechMethodId =
  "xai-grok-direct-batch";

const SERVER_BACKEND_PREFERENCE = ["ya-grok", "ya-deepgram"] as const;

const SERVER_BACKEND_LABELS: Record<
  string,
  { label: string; description: string }
> = {
  "ya-grok": {
    label: "Grok STT",
    description: "xAI speech-to-text through YA.",
  },
  "ya-deepgram": {
    label: "Deepgram STT",
    description: "Deepgram speech-to-text through YA.",
  },
  "ya-whisper": {
    label: "Whisper STT",
    description: "Local Whisper speech-to-text through YA.",
  },
  "ya-dummy": {
    label: "Dummy STT",
    description: "Test speech backend through YA.",
  },
};

export interface SpeechMethodDescriptor {
  id: SpeechMethodId;
  label: string;
  description?: string;
  /** True if this method can run without a server-side backend. */
  clientSupported: boolean;
  /** True if this method requires a server-side backend. */
  serverRouted: boolean;
}

export interface SpeechMethodCapabilities {
  streaming?: boolean;
  smartTurn?: boolean;
}

const DIRECT_XAI_BATCH_METHOD: SpeechMethodDescriptor = {
  id: XAI_DIRECT_BATCH_SPEECH_METHOD,
  label: "Grok STT direct batch",
  description: "Browser sends batch, non-streaming audio directly to xAI.",
  clientSupported: true,
  serverRouted: false,
};

const DIRECT_XAI_STREAMING_METHOD: SpeechMethodDescriptor = {
  id: XAI_DIRECT_STREAMING_SPEECH_METHOD,
  label: "Grok STT direct",
  description: "Browser streams PCM audio directly to xAI.",
  clientSupported: true,
  serverRouted: false,
};

const DIRECT_XAI_STREAMING_CAPABILITIES: SpeechMethodCapabilities = {
  streaming: true,
  smartTurn: true,
};

function browserNativeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: unknown })
        .webkitSpeechRecognition,
  );
}

export function describeBrowserNative(
  userAgent?: string,
): SpeechMethodDescriptor {
  const label = detectBrowserNativeLabel(userAgent);
  return {
    id: "browser-native",
    label: formatBrowserNativeLabel(label),
    description: label.likelySupported
      ? "Uses the browser's speech recognition directly, not through YA."
      : "This browser is unlikely to support Web Speech recognition.",
    clientSupported: browserNativeAvailable() && label.likelySupported,
    serverRouted: false,
  };
}

function normalizeBackendLabelPart(part: string): string {
  if (!part) return part;
  return `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`;
}

function formatServerBackendLabel(id: string): string {
  const trimmed = id.trim();
  const withoutYaPrefix = trimmed.startsWith("ya-")
    ? trimmed.slice("ya-".length)
    : trimmed;
  const formatted =
    withoutYaPrefix
      .split(/[-_]+/)
      .filter(Boolean)
      .map(normalizeBackendLabelPart)
      .join(" ") || trimmed;
  return trimmed.startsWith("ya-") ? `YA ${formatted}` : formatted;
}

export function describeServerBackend(id: string): SpeechMethodDescriptor {
  const knownBackend = SERVER_BACKEND_LABELS[id];
  return {
    id,
    label: knownBackend?.label ?? formatServerBackendLabel(id),
    description:
      knownBackend?.description ?? "Server-routed transcription through YA.",
    clientSupported: true,
    serverRouted: true,
  };
}

export function isServerRoutedSpeechMethod(methodId: SpeechMethodId): boolean {
  return (
    methodId !== DEFAULT_SPEECH_METHOD &&
    methodId !== XAI_DIRECT_STREAMING_SPEECH_METHOD &&
    methodId !== XAI_DIRECT_BATCH_SPEECH_METHOD
  );
}

export function getSpeechMethodCapabilities(
  methodId: SpeechMethodId,
  serverCapabilities: Readonly<Record<string, SpeechMethodCapabilities>> = {},
): SpeechMethodCapabilities {
  if (methodId === XAI_DIRECT_STREAMING_SPEECH_METHOD) {
    return DIRECT_XAI_STREAMING_CAPABILITIES;
  }
  if (methodId === DEFAULT_SPEECH_METHOD) {
    return {};
  }
  if (methodId === XAI_DIRECT_BATCH_SPEECH_METHOD) {
    return {};
  }
  return serverCapabilities[methodId] ?? {};
}

export interface SpeechMethodStreamingOptions {
  methodId: SpeechMethodId;
  serverCapabilities?: Readonly<Record<string, SpeechMethodCapabilities>>;
  grokSpeechAudioSettings?: GrokSpeechAudioSettings;
  relayTransport?: boolean;
  relayedServerSpeechAvailable?: boolean;
}

export function canSpeechMethodStream({
  methodId,
  serverCapabilities,
  grokSpeechAudioSettings,
  relayTransport = false,
  relayedServerSpeechAvailable = false,
}: SpeechMethodStreamingOptions): boolean {
  if (methodId === DEFAULT_SPEECH_METHOD) {
    return false;
  }
  if (
    isServerRoutedSpeechMethod(methodId) &&
    relayTransport &&
    !relayedServerSpeechAvailable
  ) {
    return false;
  }
  if (
    methodId === "ya-grok" &&
    grokSpeechAudioSettings?.uplinkMode === "browser-compressed"
  ) {
    return false;
  }
  return (
    getSpeechMethodCapabilities(methodId, serverCapabilities).streaming === true
  );
}

export function getOrderedServerSpeechBackends(
  serverBackends: readonly string[] = [],
): string[] {
  const seen = new Set<string>();
  const unique = serverBackends
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id !== DEFAULT_SPEECH_METHOD)
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  const rank = (id: string) => {
    const index = SERVER_BACKEND_PREFERENCE.indexOf(
      id as (typeof SERVER_BACKEND_PREFERENCE)[number],
    );
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  return unique
    .map((id, index) => ({ id, index }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.index - b.index)
    .map(({ id }) => id);
}

export function getPreferredSpeechMethod(
  serverBackends: readonly string[] = [],
): SpeechMethodId {
  return getOrderedServerSpeechBackends(serverBackends)[0] ?? DEFAULT_SPEECH_METHOD;
}

export function resolveSpeechMethod(
  storedMethod: SpeechMethodId,
  serverBackends: readonly string[] | undefined,
  hasStoredMethod: boolean,
): SpeechMethodId {
  if (serverBackends === undefined) {
    return hasStoredMethod ? storedMethod : DEFAULT_SPEECH_METHOD;
  }

  const activeServerBackends = getOrderedServerSpeechBackends(serverBackends);
  if (!hasStoredMethod) {
    return activeServerBackends[0] ?? DEFAULT_SPEECH_METHOD;
  }

  if (storedMethod === DEFAULT_SPEECH_METHOD) {
    return DEFAULT_SPEECH_METHOD;
  }

  if (
    storedMethod === XAI_DIRECT_STREAMING_SPEECH_METHOD ||
    storedMethod === XAI_DIRECT_BATCH_SPEECH_METHOD
  ) {
    return storedMethod;
  }

  return activeServerBackends.includes(storedMethod)
    ? storedMethod
    : DEFAULT_SPEECH_METHOD;
}

/**
 * Build the STT backend list from what the server advertises plus
 * the local browser-native option. Only advertised server backends
 * appear in the selector — no phantom options for unconfigured backends.
 */
export function getSpeechMethods(
  serverBackends: readonly string[] = [],
  userAgent?: string,
): SpeechMethodDescriptor[] {
  return [
    ...getOrderedServerSpeechBackends(serverBackends).map(describeServerBackend),
    DIRECT_XAI_STREAMING_METHOD,
    DIRECT_XAI_BATCH_METHOD,
    describeBrowserNative(userAgent),
  ];
}

/** @deprecated Use getSpeechMethods(serverBackends) instead. */
export function getBuiltinSpeechMethods(
  userAgent?: string,
): SpeechMethodDescriptor[] {
  return [describeBrowserNative(userAgent)];
}

export function isSpeechMethodId(value: string): value is SpeechMethodId {
  return value.trim().length > 0;
}
