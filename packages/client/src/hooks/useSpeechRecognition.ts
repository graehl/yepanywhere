import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserNativeProvider } from "../lib/speechProviders/BrowserNativeProvider";
import {
  SPEECH_STATUS_LABELS as PROVIDER_SPEECH_STATUS_LABELS,
  type SpeechProvider,
  type SpeechProviderState,
  type SpeechProviderStatus,
} from "../lib/speechProviders/SpeechProvider";

export interface UseSpeechRecognitionOptions {
  /** Language for recognition (default: browser default). */
  lang?: string;
  /** Callback when final transcript is available. */
  onResult?: (transcript: string) => void;
  /** Callback for interim results (live transcription). */
  onInterimResult?: (transcript: string) => void;
  /** Callback when recognition ends. */
  onEnd?: () => void;
  /** Callback on error. */
  onError?: (error: string) => void;
}

/**
 * Granular status of the speech recognition system.
 * Mirrors `SpeechProviderStatus` from the provider layer; re-exported
 * here so existing consumers don't need to change their imports.
 */
export type SpeechRecognitionStatus = SpeechProviderStatus;

/** Human-readable labels for each status. */
export const SPEECH_STATUS_LABELS = PROVIDER_SPEECH_STATUS_LABELS;

export interface UseSpeechRecognitionReturn {
  /** Whether the active provider is supported in this environment. */
  isSupported: boolean;
  /** Whether currently listening. */
  isListening: boolean;
  /** Granular status of the recognition system. */
  status: SpeechRecognitionStatus;
  /** Current interim transcript (updates in real-time). */
  interimTranscript: string;
  /** Start listening. */
  startListening: () => void;
  /** Stop listening. */
  stopListening: () => void;
  /** Toggle listening state. */
  toggleListening: () => void;
  /** Last error message. */
  error: string | null;
}

/**
 * Hook for using a pluggable speech-recognition provider.
 *
 * Today only the browser-native provider is wired in; the selector +
 * server-routed providers come in later phases. This hook is a thin
 * subscription layer — the active provider owns all status/error/
 * auto-restart machinery (Option B in task 006).
 */
export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
): UseSpeechRecognitionReturn {
  const { lang, onResult, onInterimResult, onEnd, onError } = options;

  // Stash callbacks in refs so the provider doesn't get recreated on every
  // render when callers pass inline handlers.
  const onResultRef = useRef(onResult);
  const onInterimResultRef = useRef(onInterimResult);
  const onEndRef = useRef(onEnd);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onResultRef.current = onResult;
    onInterimResultRef.current = onInterimResult;
    onEndRef.current = onEnd;
    onErrorRef.current = onError;
  }, [onResult, onInterimResult, onEnd, onError]);

  const providerRef = useRef<SpeechProvider | null>(null);
  if (providerRef.current === null) {
    providerRef.current = new BrowserNativeProvider({
      lang,
      onResult: (t) => onResultRef.current?.(t),
      onInterimResult: (t) => onInterimResultRef.current?.(t),
      onEnd: () => onEndRef.current?.(),
      onError: (e) => onErrorRef.current?.(e),
    });
  }

  const [state, setState] = useState<SpeechProviderState>(() =>
    providerRef.current!.getState(),
  );

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    const unsubscribe = provider.subscribe(setState);
    return () => {
      unsubscribe();
    };
  }, []);

  // Dispose on unmount.
  useEffect(() => {
    return () => {
      providerRef.current?.dispose();
      providerRef.current = null;
    };
  }, []);

  const startListening = useCallback(() => {
    providerRef.current?.start();
  }, []);

  const stopListening = useCallback(() => {
    providerRef.current?.stop();
  }, []);

  const toggleListening = useCallback(() => {
    const provider = providerRef.current;
    if (!provider) return;
    if (provider.getState().isListening) {
      provider.stop();
    } else {
      provider.start();
    }
  }, []);

  return {
    isSupported: providerRef.current?.isSupported ?? false,
    isListening: state.isListening,
    status: state.status,
    interimTranscript: state.interimTranscript,
    startListening,
    stopListening,
    toggleListening,
    error: state.error,
  };
}
