import { useSyncExternalStore } from "react";

type StoreListener = () => void;

import {
  LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
  type ClientSummarySourceKey,
} from "./clientSourceIdentity";
export {
  asClientSummarySourceKey,
  createClientSummaryHostSourceKey,
  createClientSummaryDirectSourceKey,
  LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
  REMOTE_NONE_CLIENT_SUMMARY_SOURCE_KEY,
  type ClientSummarySourceKey,
} from "./clientSourceIdentity";

const currentSourceKeyListeners = new Set<StoreListener>();
let currentClientSummarySourceKey = LOCAL_CLIENT_SUMMARY_SOURCE_KEY;

export function getCurrentClientSummarySourceKey(): ClientSummarySourceKey {
  return currentClientSummarySourceKey;
}

export function subscribeClientSummarySourceKey(
  listener: StoreListener,
): () => void {
  currentSourceKeyListeners.add(listener);
  return () => {
    currentSourceKeyListeners.delete(listener);
  };
}

export function useClientSummarySourceKey(): ClientSummarySourceKey {
  return useSyncExternalStore(
    subscribeClientSummarySourceKey,
    getCurrentClientSummarySourceKey,
    getCurrentClientSummarySourceKey,
  );
}

export function setCurrentClientSummarySourceKey(
  key: ClientSummarySourceKey,
): void {
  if (key === currentClientSummarySourceKey) {
    return;
  }

  currentClientSummarySourceKey = key;
  for (const listener of Array.from(currentSourceKeyListeners)) {
    listener();
  }
}

export function resetClientSummarySourceKeyForTests(): void {
  currentClientSummarySourceKey = LOCAL_CLIENT_SUMMARY_SOURCE_KEY;
  currentSourceKeyListeners.clear();
}
