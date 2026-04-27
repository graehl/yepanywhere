/**
 * Catalog of known speech-recognition methods exposed in the UI.
 *
 * Each entry is a stable `id` plus a static label and a check for whether
 * it is currently usable. The `browser-native` method is always known but
 * its availability depends on `window.SpeechRecognition`. Server-routed
 * methods (`ya-dummy`, `ya-deepgram`, `ya-whisper`, ...) are ultimately
 * gated on a server capability advertisement; the client-side registry
 * captures their existence and label so the UI is stable even before the
 * server reports its enabled set.
 */

import {
  detectBrowserNativeLabel,
  formatBrowserNativeLabel,
} from "./browserNativeLabel";

export type SpeechMethodId =
  | "browser-native"
  | "ya-dummy"
  | "ya-deepgram"
  | "ya-whisper";

export const DEFAULT_SPEECH_METHOD: SpeechMethodId = "browser-native";

export interface SpeechMethodDescriptor {
  id: SpeechMethodId;
  /** Static display label; UA-derived for `browser-native`. */
  label: string;
  /** Optional sub-label for the dropdown row. */
  description?: string;
  /** True if this method can run client-side today. Server methods need a server capability check. */
  clientSupported: boolean;
  /** True if this method requires a server-side backend (vs running in the browser). */
  serverRouted: boolean;
}

function browserNativeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as unknown as { SpeechRecognition?: unknown })
      .SpeechRecognition ??
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
      ? "Runs in the browser; no audio leaves this device."
      : "This browser is unlikely to support Web Speech recognition.",
    clientSupported: browserNativeAvailable() && label.likelySupported,
    serverRouted: false,
  };
}

export function describeYaDummy(): SpeechMethodDescriptor {
  return {
    id: "ya-dummy",
    label: "YA dummy (test only)",
    description: "Fake server backend that echoes a canned transcript.",
    clientSupported: true,
    serverRouted: true,
  };
}

/**
 * Built-in catalog used for the selector. Server-side advertisement may
 * later remove or augment entries (e.g. add `ya-deepgram` only when a key
 * validated at startup).
 */
export function getBuiltinSpeechMethods(
  userAgent?: string,
): SpeechMethodDescriptor[] {
  return [describeBrowserNative(userAgent), describeYaDummy()];
}

export function isKnownSpeechMethodId(value: string): value is SpeechMethodId {
  return (
    value === "browser-native" ||
    value === "ya-dummy" ||
    value === "ya-deepgram" ||
    value === "ya-whisper"
  );
}
