import type {
  ProjectQueueChangedEvent,
  ProjectQueueItemSummary,
} from "@yep-anywhere/shared";
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
  applyProjectCollectionSnapshot,
  applyProjectsCollectionSnapshot,
  applyProjectQueueCollectionChanged,
  applyProjectQueueCollectionSnapshot,
  applySessionCollectionCreated,
  applySessionCollectionMetadataChanged,
  applySessionCollectionProcessStateChanged,
  applySessionCollectionSeen,
  applySessionCollectionStatusChanged,
  applySessionCollectionUpdated,
  createEmptySessionCollectionState,
  createGlobalSessionsQueryKey,
  selectProjectCollectionRecord,
  selectProjectCollectionRecords,
  selectProjectQueuedSessionIds,
  selectProjectQueueItemsByProject,
  selectOlderSessionRecords,
  selectRecentSessionRecords,
  selectSessionCollectionQueryRecords,
  selectSessionCollectionQueryState,
  selectSessionCollectionRecord,
  selectStarredSessionRecords,
  type GlobalSessionsCollectionSnapshot,
  type ProjectCollectionRecord,
  type ProjectCollectionSnapshot,
  type ProjectQueueCollectionSnapshot,
  type ProjectsCollectionSnapshot,
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

function reduceProjectQueueChanged(event: ProjectQueueChangedEvent): void {
  updateSnapshot((current) =>
    applyProjectQueueCollectionChanged(current, event),
  );
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
    activityBus.on("project-queue-changed", reduceProjectQueueChanged),
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

export function reportProjectsCollectionSnapshot(
  input: ProjectsCollectionSnapshot,
  requestStartedAt = Date.now(),
): void {
  updateSnapshot((current) =>
    applyProjectsCollectionSnapshot(current, input, requestStartedAt),
  );
}

export function reportProjectCollectionSnapshot(
  input: ProjectCollectionSnapshot,
  requestStartedAt = Date.now(),
): void {
  updateSnapshot((current) =>
    applyProjectCollectionSnapshot(current, input, requestStartedAt),
  );
}

export function reportProjectQueueCollectionSnapshot(
  input: ProjectQueueCollectionSnapshot,
  requestStartedAt = Date.now(),
): void {
  updateSnapshot((current) =>
    applyProjectQueueCollectionSnapshot(current, input, requestStartedAt),
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

export function useProjectCollectionRecord(
  projectId: string | null | undefined,
): ProjectCollectionRecord | undefined {
  useSessionCollectionActivitySubscription();
  return useStore(sessionCollectionStore, (state) =>
    selectProjectCollectionRecord(state, projectId),
  );
}

export function useProjectCollectionRecords(): ProjectCollectionRecord[] {
  const state = useSessionCollectionState();
  return useMemo(() => selectProjectCollectionRecords(state), [state]);
}

export function useProjectQueueItemsByProject(
  projectIds: readonly string[],
): Record<string, readonly ProjectQueueItemSummary[]> {
  useSessionCollectionActivitySubscription();
  const byProject = useStore(
    sessionCollectionStore,
    (state) => state.projectQueues.byProject,
  );
  const projectIdsKey = projectIds.join("\0");
  const selectedProjectIds = useMemo(() => [...projectIds], [projectIdsKey]);
  return useMemo(
    () =>
      selectProjectQueueItemsByProject(
        {
          ...sessionCollectionStore.getState(),
          projectQueues: { byProject },
        },
        selectedProjectIds,
      ),
    [byProject, selectedProjectIds],
  );
}

export function useProjectQueuedSessionIds(
  projectIds: readonly string[],
): ReadonlySet<string> {
  useSessionCollectionActivitySubscription();
  const byProject = useStore(
    sessionCollectionStore,
    (state) => state.projectQueues.byProject,
  );
  const projectIdsKey = projectIds.join("\0");
  const selectedProjectIds = useMemo(() => [...projectIds], [projectIdsKey]);
  return useMemo(
    () =>
      selectProjectQueuedSessionIds(
        {
          ...sessionCollectionStore.getState(),
          projectQueues: { byProject },
        },
        selectedProjectIds,
      ),
    [byProject, selectedProjectIds],
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
