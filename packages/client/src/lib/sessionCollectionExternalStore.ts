import { useMemo, useSyncExternalStore } from "react";
import {
  activityBus,
  type ProcessStateEvent,
  type SessionCreatedEvent,
  type SessionMetadataChangedEvent,
  type SessionSeenEvent,
  type SessionStatusEvent,
  type SessionUpdatedEvent,
} from "./activityBus";
import {
  applyGlobalSessionsCollectionSnapshot,
  applySessionCollectionCreated,
  applySessionCollectionMetadataChanged,
  applySessionCollectionProcessStateChanged,
  applySessionCollectionSeen,
  applySessionCollectionStatusChanged,
  applySessionCollectionUpdated,
  createEmptySessionCollectionState,
  createGlobalSessionsQueryKey,
  selectOlderSessionRecords,
  selectRecentSessionRecords,
  selectSessionCollectionQueryRecords,
  selectSessionCollectionRecord,
  selectStarredSessionRecords,
  type GlobalSessionsCollectionSnapshot,
  type SessionCollectionQueryDescriptor,
  type SessionCollectionRecord,
  type SessionCollectionState,
} from "./sessionCollectionStore";

type StoreListener = () => void;
type BusUnsubscribe = () => void;

let snapshot: SessionCollectionState = createEmptySessionCollectionState();
const listeners = new Set<StoreListener>();
let activityBusUnsubscribers: BusUnsubscribe[] | null = null;

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function updateSnapshot(
  update: (current: SessionCollectionState) => SessionCollectionState,
): void {
  snapshot = update(snapshot);
  notifyListeners();
}

function reduceProcessStateChanged(event: ProcessStateEvent): void {
  updateSnapshot((current) =>
    applySessionCollectionProcessStateChanged(current, event),
  );
}

function reduceSessionStatusChanged(event: SessionStatusEvent): void {
  updateSnapshot((current) =>
    applySessionCollectionStatusChanged(current, event),
  );
}

function reduceSessionSeen(event: SessionSeenEvent): void {
  updateSnapshot((current) => applySessionCollectionSeen(current, event));
}

function reduceSessionUpdated(event: SessionUpdatedEvent): void {
  updateSnapshot((current) => applySessionCollectionUpdated(current, event));
}

function reduceSessionMetadataChanged(
  event: SessionMetadataChangedEvent,
): void {
  updateSnapshot((current) =>
    applySessionCollectionMetadataChanged(current, event),
  );
}

function reduceSessionCreated(event: SessionCreatedEvent): void {
  updateSnapshot((current) => applySessionCollectionCreated(current, event));
}

function startActivityBusSubscription(): void {
  if (activityBusUnsubscribers) {
    return;
  }

  activityBusUnsubscribers = [
    activityBus.on("process-state-changed", reduceProcessStateChanged),
    activityBus.on("session-status-changed", reduceSessionStatusChanged),
    activityBus.on("session-seen", reduceSessionSeen),
    activityBus.on("session-updated", reduceSessionUpdated),
    activityBus.on("session-metadata-changed", reduceSessionMetadataChanged),
    activityBus.on("session-created", reduceSessionCreated),
  ];
}

function stopActivityBusSubscriptionIfIdle(): void {
  if (listeners.size > 0 || !activityBusUnsubscribers) {
    return;
  }

  for (const unsubscribe of activityBusUnsubscribers) {
    unsubscribe();
  }
  activityBusUnsubscribers = null;
}

export function subscribeSessionCollection(
  listener: StoreListener,
): () => void {
  listeners.add(listener);
  startActivityBusSubscription();

  return () => {
    listeners.delete(listener);
    stopActivityBusSubscriptionIfIdle();
  };
}

export function getSessionCollectionSnapshot(): SessionCollectionState {
  return snapshot;
}

export function getSessionCollectionServerSnapshot(): SessionCollectionState {
  return snapshot;
}

export function reportGlobalSessionsCollectionSnapshot(
  input: GlobalSessionsCollectionSnapshot,
  requestStartedAt = Date.now(),
): void {
  updateSnapshot((current) =>
    applyGlobalSessionsCollectionSnapshot(current, input, requestStartedAt),
  );
}

export function useSessionCollectionState(): SessionCollectionState {
  return useSyncExternalStore(
    subscribeSessionCollection,
    getSessionCollectionSnapshot,
    getSessionCollectionServerSnapshot,
  );
}

export function useSessionCollectionRecord(
  sessionId: string | null | undefined,
): SessionCollectionRecord | undefined {
  const state = useSessionCollectionState();
  return selectSessionCollectionRecord(state, sessionId);
}

export function useStarredSessionRecords(): SessionCollectionRecord[] {
  return selectStarredSessionRecords(useSessionCollectionState());
}

export function useRecentSessionRecords(now?: number): SessionCollectionRecord[] {
  return selectRecentSessionRecords(useSessionCollectionState(), now);
}

export function useOlderSessionRecords(now?: number): SessionCollectionRecord[] {
  return selectOlderSessionRecords(useSessionCollectionState(), now);
}

export function useSessionCollectionQueryRecords(
  query: SessionCollectionQueryDescriptor,
): SessionCollectionRecord[] {
  const state = useSessionCollectionState();
  const key = createGlobalSessionsQueryKey(query);
  return useMemo(
    () => selectSessionCollectionQueryRecords(state, query),
    [state, key, query],
  );
}

export function resetSessionCollectionStoreForTests(): void {
  snapshot = createEmptySessionCollectionState();
  listeners.clear();
  if (activityBusUnsubscribers) {
    for (const unsubscribe of activityBusUnsubscribers) {
      unsubscribe();
    }
    activityBusUnsubscribers = null;
  }
}
