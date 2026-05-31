import { useSyncExternalStore } from "react";
import {
  getRemoteLogCollectionEnabled,
  setRemoteLogCollectionEnabledValue,
  subscribeDeveloperMode,
} from "../../hooks/useDeveloperMode";
import { ClientLogCollector } from "./ClientLogCollector";

export const clientLogCollector = new ClientLogCollector();

export interface ClientLogCollectionStatus {
  active: boolean;
  localRequested: boolean;
}

const statusListeners = new Set<() => void>();
let currentStatus: ClientLogCollectionStatus = buildStatus();
let developerModeUnsubscribe: (() => void) | null = null;
let initCount = 0;

function buildStatus(): ClientLogCollectionStatus {
  const localRequested = getRemoteLogCollectionEnabled();
  const active = localRequested;
  return {
    active,
    localRequested,
  };
}

function sameStatus(
  a: ClientLogCollectionStatus,
  b: ClientLogCollectionStatus,
): boolean {
  return a.active === b.active && a.localRequested === b.localRequested;
}

function notifyStatusListeners(): void {
  for (const listener of statusListeners) {
    listener();
  }
}

function applyCollectionStatus(): void {
  const nextStatus = buildStatus();
  if (nextStatus.active) {
    void clientLogCollector.start();
  } else {
    clientLogCollector.stop();
  }

  if (!sameStatus(nextStatus, currentStatus)) {
    currentStatus = nextStatus;
    notifyStatusListeners();
  } else {
    currentStatus = nextStatus;
  }
}

function subscribeStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function getStatusSnapshot(): ClientLogCollectionStatus {
  return currentStatus;
}

export function useClientLogCollectionStatus(): ClientLogCollectionStatus {
  return useSyncExternalStore(subscribeStatus, getStatusSnapshot);
}

export function isClientLogCollectionActive(): boolean {
  return currentStatus.active;
}

export function disableClientLogCollection(): void {
  setRemoteLogCollectionEnabledValue(false);
}

/**
 * Initialize client log collection based on the local developer mode setting.
 * Returns a cleanup function.
 */
export function initClientLogCollection(): () => void {
  initCount += 1;
  if (initCount === 1) {
    currentStatus = buildStatus();
    applyCollectionStatus();
    developerModeUnsubscribe = subscribeDeveloperMode(applyCollectionStatus);
  }

  return () => {
    initCount -= 1;
    if (initCount > 0) return;
    initCount = 0;
    developerModeUnsubscribe?.();
    developerModeUnsubscribe = null;
    currentStatus = buildStatus();
    clientLogCollector.stop();
    notifyStatusListeners();
  };
}
