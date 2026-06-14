import { useCallback, useEffect, useState } from "react";
import { UI_KEYS } from "../lib/storageKeys";

const subscribers = new Set<() => void>();

function canUseLocalStorage(): boolean {
  return (
    typeof globalThis.localStorage !== "undefined" &&
    typeof globalThis.localStorage.getItem === "function" &&
    typeof globalThis.localStorage.setItem === "function"
  );
}

export function getSpeechKeepMicWarmSetting(): boolean {
  if (!canUseLocalStorage()) return false;
  return globalThis.localStorage.getItem(UI_KEYS.speechKeepMicWarm) === "true";
}

export function setSpeechKeepMicWarmSetting(enabled: boolean): void {
  if (canUseLocalStorage()) {
    globalThis.localStorage.setItem(
      UI_KEYS.speechKeepMicWarm,
      enabled ? "true" : "false",
    );
  }
  for (const subscriber of subscribers) subscriber();
}

export function useSpeechCaptureSettings() {
  const [keepMicWarm, setKeepMicWarmState] = useState(
    getSpeechKeepMicWarmSetting,
  );

  useEffect(() => {
    const update = () => setKeepMicWarmState(getSpeechKeepMicWarmSetting());
    subscribers.add(update);
    globalThis.addEventListener?.("storage", update);
    return () => {
      subscribers.delete(update);
      globalThis.removeEventListener?.("storage", update);
    };
  }, []);

  const setKeepMicWarm = useCallback((enabled: boolean) => {
    setSpeechKeepMicWarmSetting(enabled);
  }, []);

  return { keepMicWarm, setKeepMicWarm };
}
