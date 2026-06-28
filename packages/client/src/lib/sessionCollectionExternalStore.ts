import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
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
  selectSessionCollectionQueryState,
  selectSessionCollectionRecord,
  selectStarredSessionRecords,
  type GlobalSessionsCollectionSnapshot,
  type SessionCollectionQueryDescriptor,
  type SessionCollectionRecord,
  type SessionCollectionQueryState,
  type SessionCollectionState,
} from "./sessionCollectionStore";

type StoreListener = () => void;
type BusUnsubscribe = () => void;

const sessionCollectionStore = createStore<SessionCollectionState>(() =>
  createEmptySessionCollectionState(),
);
let mountedConsumerCount = 0;
let activityBusUnsubscribers: BusUnsubscribe[] | null = null;

function updateSnapshot(
  update: (current: SessionCollectionState) => SessionCollectionState,
): void {
  const current = sessionCollectionStore.getState();
  const next = update(current);
  if (next !== current) {
    sessionCollectionStore.setState(next, true);
  }
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
  if (mountedConsumerCount > 0 || !activityBusUnsubscribers) {
    return;
  }

  for (const unsubscribe of activityBusUnsubscribers) {
    unsubscribe();
  }
  activityBusUnsubscribers = null;
}

function retainActivityBusSubscription(): () => void {
  mountedConsumerCount += 1;
  startActivityBusSubscription();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    mountedConsumerCount = Math.max(0, mountedConsumerCount - 1);
    stopActivityBusSubscriptionIfIdle();
  };
}

function useSessionCollectionActivitySubscription(): void {
  useEffect(() => retainActivityBusSubscription(), []);
}

export function subscribeSessionCollection(
  listener: StoreListener,
): () => void {
  const releaseActivityBus = retainActivityBusSubscription();
  const unsubscribe = sessionCollectionStore.subscribe(() => listener());

  return () => {
    unsubscribe();
    releaseActivityBus();
  };
}

export function getSessionCollectionSnapshot(): SessionCollectionState {
  return sessionCollectionStore.getState();
}

export function getSessionCollectionServerSnapshot(): SessionCollectionState {
  return sessionCollectionStore.getState();
}

export function reportGlobalSessionsCollectionSnapshot(
  input: GlobalSessionsCollectionSnapshot,
  requestStartedAt = Date.now(),
): void {
  updateSnapshot((current) =>
    applyGlobalSessionsCollectionSnapshot(current, input, requestStartedAt),
  );
}

export function reportSessionCollectionCreated(
  event: SessionCreatedEvent,
  observedAt = Date.now(),
): void {
  updateSnapshot((current) =>
    applySessionCollectionCreated(current, event, observedAt),
  );
}

export function reportSessionCollectionMetadataChanged(
  event: SessionMetadataChangedEvent,
  observedAt = Date.now(),
): void {
  updateSnapshot((current) =>
    applySessionCollectionMetadataChanged(current, event, observedAt),
  );
}

export function useSessionCollectionState(): SessionCollectionState {
  useSessionCollectionActivitySubscription();
  return useStore(sessionCollectionStore);
}

export function useSessionCollectionRecord(
  sessionId: string | null | undefined,
): SessionCollectionRecord | undefined {
  useSessionCollectionActivitySubscription();
  return useStore(sessionCollectionStore, (state) =>
    selectSessionCollectionRecord(state, sessionId),
  );
}

export function useStarredSessionRecords(): SessionCollectionRecord[] {
  const state = useSessionCollectionState();
  return useMemo(() => selectStarredSessionRecords(state), [state]);
}

export function useRecentSessionRecords(now?: number): SessionCollectionRecord[] {
  const state = useSessionCollectionState();
  return useMemo(() => selectRecentSessionRecords(state, now), [state, now]);
}

export function useOlderSessionRecords(now?: number): SessionCollectionRecord[] {
  const state = useSessionCollectionState();
  return useMemo(() => selectOlderSessionRecords(state, now), [state, now]);
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

export function useSessionCollectionQueryState(
  query: SessionCollectionQueryDescriptor,
): SessionCollectionQueryState | undefined {
  useSessionCollectionActivitySubscription();
  return useStore(sessionCollectionStore, (state) =>
    selectSessionCollectionQueryState(state, query),
  );
}

export function resetSessionCollectionStoreForTests(): void {
  sessionCollectionStore.setState(createEmptySessionCollectionState(), true);
  mountedConsumerCount = 0;
  if (activityBusUnsubscribers) {
    for (const unsubscribe of activityBusUnsubscribers) {
      unsubscribe();
    }
    activityBusUnsubscribers = null;
  }
}
