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
  applyDraftSessionIdsSnapshot,
  applyGlobalSessionsCollectionSnapshot,
  applyInboxCollectionSnapshot,
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
  createEmptyClientSummaryState,
  createGlobalSessionsQueryKey,
  selectDraftSessionIds,
  selectInboxResponse,
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
  type InboxCollectionSnapshot,
  type ProjectCollectionRecord,
  type ProjectCollectionSnapshot,
  type ProjectQueueCollectionSnapshot,
  type ProjectsCollectionSnapshot,
  type SessionCollectionQueryDescriptor,
  type SessionCollectionRecord,
  type SessionCollectionQueryState,
  type ClientSummaryState,
} from "./clientSummaryState";
import {
  isSessionDraftStorageKey,
  scanSessionDraftIds,
} from "./sessionDraftStorage";

type StoreListener = () => void;
type BusUnsubscribe = () => void;
type ReleaseSubscription = () => void;

const DRAFT_DECORATION_SCAN_INTERVAL_MS = 1000;

const clientSummaryStore = createStore<ClientSummaryState>(() =>
  createEmptyClientSummaryState(),
);
let mountedConsumerCount = 0;
let activityBusUnsubscribers: BusUnsubscribe[] | null = null;
let mountedDraftDecorationConsumerCount = 0;
let draftDecorationRelease: ReleaseSubscription | null = null;

function updateSnapshot(
  update: (current: ClientSummaryState) => ClientSummaryState,
): void {
  const current = clientSummaryStore.getState();
  const next = update(current);
  if (next !== current) {
    clientSummaryStore.setState(next, true);
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

function useClientSummaryActivitySubscription(): void {
  useEffect(() => retainActivityBusSubscription(), []);
}

export function reportDraftSessionIdsSnapshot(
  draftSessionIds: ReadonlySet<string>,
  observedAt = Date.now(),
): void {
  updateSnapshot((current) =>
    applyDraftSessionIdsSnapshot(current, draftSessionIds, observedAt),
  );
}

function scanDraftSessionIdsIntoStore(): void {
  reportDraftSessionIdsSnapshot(scanSessionDraftIds());
}

function startDraftDecorationSubscription(): void {
  if (draftDecorationRelease) {
    return;
  }

  scanDraftSessionIdsIntoStore();

  if (typeof window === "undefined") {
    draftDecorationRelease = () => {};
    return;
  }

  const handleStorage = (event: StorageEvent) => {
    if (isSessionDraftStorageKey(event.key)) {
      scanDraftSessionIdsIntoStore();
    }
  };

  window.addEventListener("storage", handleStorage);
  const interval = window.setInterval(
    scanDraftSessionIdsIntoStore,
    DRAFT_DECORATION_SCAN_INTERVAL_MS,
  );

  draftDecorationRelease = () => {
    window.removeEventListener("storage", handleStorage);
    window.clearInterval(interval);
  };
}

function stopDraftDecorationSubscriptionIfIdle(): void {
  if (mountedDraftDecorationConsumerCount > 0 || !draftDecorationRelease) {
    return;
  }

  draftDecorationRelease();
  draftDecorationRelease = null;
}

function retainDraftDecorationSubscription(): () => void {
  mountedDraftDecorationConsumerCount += 1;
  startDraftDecorationSubscription();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    mountedDraftDecorationConsumerCount = Math.max(
      0,
      mountedDraftDecorationConsumerCount - 1,
    );
    stopDraftDecorationSubscriptionIfIdle();
  };
}

function useDraftDecorationSubscription(): void {
  useEffect(() => retainDraftDecorationSubscription(), []);
}

export function subscribeClientSummary(
  listener: StoreListener,
): () => void {
  const releaseActivityBus = retainActivityBusSubscription();
  const unsubscribe = clientSummaryStore.subscribe(() => listener());

  return () => {
    unsubscribe();
    releaseActivityBus();
  };
}

export function getClientSummarySnapshot(): ClientSummaryState {
  return clientSummaryStore.getState();
}

export function getClientSummaryServerSnapshot(): ClientSummaryState {
  return clientSummaryStore.getState();
}

export function reportGlobalSessionsCollectionSnapshot(
  input: GlobalSessionsCollectionSnapshot,
  requestStartedAt = Date.now(),
): void {
  updateSnapshot((current) =>
    applyGlobalSessionsCollectionSnapshot(current, input, requestStartedAt),
  );
}

export function reportInboxCollectionSnapshot(
  input: InboxCollectionSnapshot,
  requestStartedAt = Date.now(),
): void {
  updateSnapshot((current) =>
    applyInboxCollectionSnapshot(current, input, requestStartedAt),
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

export function useClientSummaryState(): ClientSummaryState {
  useClientSummaryActivitySubscription();
  return useStore(clientSummaryStore);
}

export function useSessionCollectionRecord(
  sessionId: string | null | undefined,
): SessionCollectionRecord | undefined {
  useClientSummaryActivitySubscription();
  return useStore(clientSummaryStore, (state) =>
    selectSessionCollectionRecord(state, sessionId),
  );
}

export function useProjectCollectionRecord(
  projectId: string | null | undefined,
): ProjectCollectionRecord | undefined {
  useClientSummaryActivitySubscription();
  return useStore(clientSummaryStore, (state) =>
    selectProjectCollectionRecord(state, projectId),
  );
}

export function useProjectCollectionRecords(): ProjectCollectionRecord[] {
  const state = useClientSummaryState();
  return useMemo(() => selectProjectCollectionRecords(state), [state]);
}

export function useProjectQueueItemsByProject(
  projectIds: readonly string[],
): Record<string, readonly ProjectQueueItemSummary[]> {
  useClientSummaryActivitySubscription();
  const byProject = useStore(
    clientSummaryStore,
    (state) => state.projectQueues.byProject,
  );
  const projectIdsKey = projectIds.join("\0");
  const selectedProjectIds = useMemo(() => [...projectIds], [projectIdsKey]);
  return useMemo(
    () =>
      selectProjectQueueItemsByProject(
        {
          ...clientSummaryStore.getState(),
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
  useClientSummaryActivitySubscription();
  const byProject = useStore(
    clientSummaryStore,
    (state) => state.projectQueues.byProject,
  );
  const projectIdsKey = projectIds.join("\0");
  const selectedProjectIds = useMemo(() => [...projectIds], [projectIdsKey]);
  return useMemo(
    () =>
      selectProjectQueuedSessionIds(
        {
          ...clientSummaryStore.getState(),
          projectQueues: { byProject },
        },
        selectedProjectIds,
      ),
    [byProject, selectedProjectIds],
  );
}

export function useDraftSessionIds(): ReadonlySet<string> {
  useDraftDecorationSubscription();
  return useStore(clientSummaryStore, selectDraftSessionIds);
}

export function useInboxResponseSnapshot(): InboxCollectionSnapshot {
  const state = useClientSummaryState();
  return useMemo(() => selectInboxResponse(state), [state]);
}

export function useStarredSessionRecords(): SessionCollectionRecord[] {
  const state = useClientSummaryState();
  return useMemo(() => selectStarredSessionRecords(state), [state]);
}

export function useRecentSessionRecords(now?: number): SessionCollectionRecord[] {
  const state = useClientSummaryState();
  return useMemo(() => selectRecentSessionRecords(state, now), [state, now]);
}

export function useOlderSessionRecords(now?: number): SessionCollectionRecord[] {
  const state = useClientSummaryState();
  return useMemo(() => selectOlderSessionRecords(state, now), [state, now]);
}

export function useSessionCollectionQueryRecords(
  query: SessionCollectionQueryDescriptor,
): SessionCollectionRecord[] {
  const state = useClientSummaryState();
  const key = createGlobalSessionsQueryKey(query);
  return useMemo(
    () => selectSessionCollectionQueryRecords(state, query),
    [state, key, query],
  );
}

export function useSessionCollectionQueryState(
  query: SessionCollectionQueryDescriptor,
): SessionCollectionQueryState | undefined {
  useClientSummaryActivitySubscription();
  return useStore(clientSummaryStore, (state) =>
    selectSessionCollectionQueryState(state, query),
  );
}

export function resetClientSummaryStoreForTests(): void {
  clientSummaryStore.setState(createEmptyClientSummaryState(), true);
  mountedConsumerCount = 0;
  mountedDraftDecorationConsumerCount = 0;
  if (activityBusUnsubscribers) {
    for (const unsubscribe of activityBusUnsubscribers) {
      unsubscribe();
    }
    activityBusUnsubscribers = null;
  }
  if (draftDecorationRelease) {
    draftDecorationRelease();
    draftDecorationRelease = null;
  }
}
