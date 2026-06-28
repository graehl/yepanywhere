import type {
  ProjectQueueChangedEvent,
  ProjectQueueItemSummary,
} from "@yep-anywhere/shared";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
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
  selectActiveAgentCount,
  selectActiveProjectSessionIds,
  selectDraftSessionIds,
  selectHasActiveAgents,
  selectInboxCounts,
  selectInboxCountsByProject,
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
  type InboxCounts,
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

export type ClientSummarySourceKey = string & {
  readonly __brand: "ClientSummarySourceKey";
};

export function asClientSummarySourceKey(
  value: string,
): ClientSummarySourceKey {
  return value as ClientSummarySourceKey;
}

export function createClientSummaryHostSourceKey(
  savedHostId: string,
): ClientSummarySourceKey {
  return asClientSummarySourceKey(`host:${savedHostId}`);
}

export function createClientSummaryDirectSourceKey(
  normalizedWsUrl: string,
): ClientSummarySourceKey {
  return asClientSummarySourceKey(`direct:${normalizedWsUrl}`);
}

export const LOCAL_CLIENT_SUMMARY_SOURCE_KEY =
  asClientSummarySourceKey("local");

export const REMOTE_NONE_CLIENT_SUMMARY_SOURCE_KEY =
  asClientSummarySourceKey("remote:none");

const clientSummaryStoresBySource = new Map<
  ClientSummarySourceKey,
  StoreApi<ClientSummaryState>
>();
const currentSourceKeyListeners = new Set<StoreListener>();
let currentClientSummarySourceKey = LOCAL_CLIENT_SUMMARY_SOURCE_KEY;
let mountedConsumerCount = 0;
let activityBusUnsubscribers: BusUnsubscribe[] | null = null;
let mountedDraftDecorationConsumerCount = 0;
let draftDecorationRelease: ReleaseSubscription | null = null;

function createClientSummaryStore(): StoreApi<ClientSummaryState> {
  return createStore<ClientSummaryState>(() => createEmptyClientSummaryState());
}

export function getClientSummaryStoreForSource(
  key: ClientSummarySourceKey,
): StoreApi<ClientSummaryState> {
  let store = clientSummaryStoresBySource.get(key);
  if (!store) {
    store = createClientSummaryStore();
    clientSummaryStoresBySource.set(key, store);
  }
  return store;
}

export function getCurrentClientSummarySourceKey(): ClientSummarySourceKey {
  return currentClientSummarySourceKey;
}

function subscribeClientSummarySourceKey(
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

export function getCurrentClientSummaryStore(): StoreApi<ClientSummaryState> {
  return getClientSummaryStoreForSource(currentClientSummarySourceKey);
}

function useCurrentClientSummaryStore(): StoreApi<ClientSummaryState> {
  const sourceKey = useClientSummarySourceKey();
  return useMemo(() => getClientSummaryStoreForSource(sourceKey), [sourceKey]);
}

export function clearClientSummarySource(key: ClientSummarySourceKey): void {
  const store = clientSummaryStoresBySource.get(key);
  store?.setState(createEmptyClientSummaryState(), true);
}

function updateStoreSnapshot(
  store: StoreApi<ClientSummaryState>,
  update: (current: ClientSummaryState) => ClientSummaryState,
): void {
  const current = store.getState();
  const next = update(current);
  if (next !== current) {
    store.setState(next, true);
  }
}

function updateCurrentSnapshot(
  update: (current: ClientSummaryState) => ClientSummaryState,
): void {
  updateStoreSnapshot(getCurrentClientSummaryStore(), update);
}

function reduceProcessStateChanged(event: ProcessStateEvent): void {
  updateCurrentSnapshot((current) =>
    applySessionCollectionProcessStateChanged(current, event),
  );
}

function reduceSessionStatusChanged(event: SessionStatusEvent): void {
  updateCurrentSnapshot((current) =>
    applySessionCollectionStatusChanged(current, event),
  );
}

function reduceSessionSeen(event: SessionSeenEvent): void {
  updateCurrentSnapshot((current) => applySessionCollectionSeen(current, event));
}

function reduceSessionUpdated(event: SessionUpdatedEvent): void {
  updateCurrentSnapshot((current) =>
    applySessionCollectionUpdated(current, event),
  );
}

function reduceSessionMetadataChanged(
  event: SessionMetadataChangedEvent,
): void {
  updateCurrentSnapshot((current) =>
    applySessionCollectionMetadataChanged(current, event),
  );
}

function reduceSessionCreated(event: SessionCreatedEvent): void {
  updateCurrentSnapshot((current) =>
    applySessionCollectionCreated(current, event),
  );
}

function reduceProjectQueueChanged(event: ProjectQueueChangedEvent): void {
  updateCurrentSnapshot((current) =>
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
  updateCurrentSnapshot((current) =>
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
  let currentStore = getCurrentClientSummaryStore();
  let unsubscribeStore = currentStore.subscribe(() => listener());
  const unsubscribeSourceKey = subscribeClientSummarySourceKey(() => {
    unsubscribeStore();
    currentStore = getCurrentClientSummaryStore();
    unsubscribeStore = currentStore.subscribe(() => listener());
    listener();
  });

  return () => {
    unsubscribeSourceKey();
    unsubscribeStore();
    releaseActivityBus();
  };
}

export function getClientSummarySnapshot(): ClientSummaryState {
  return getCurrentClientSummaryStore().getState();
}

export function getClientSummaryServerSnapshot(): ClientSummaryState {
  return getCurrentClientSummaryStore().getState();
}

export function reportGlobalSessionsCollectionSnapshot(
  sourceKey: ClientSummarySourceKey,
  input: GlobalSessionsCollectionSnapshot,
  requestStartedAt = Date.now(),
): void {
  updateStoreSnapshot(getClientSummaryStoreForSource(sourceKey), (current) =>
    applyGlobalSessionsCollectionSnapshot(current, input, requestStartedAt),
  );
}

export function reportInboxCollectionSnapshot(
  sourceKey: ClientSummarySourceKey,
  input: InboxCollectionSnapshot,
  requestStartedAt = Date.now(),
): void {
  updateStoreSnapshot(getClientSummaryStoreForSource(sourceKey), (current) =>
    applyInboxCollectionSnapshot(current, input, requestStartedAt),
  );
}

export function reportProjectsCollectionSnapshot(
  sourceKey: ClientSummarySourceKey,
  input: ProjectsCollectionSnapshot,
  requestStartedAt = Date.now(),
): void {
  updateStoreSnapshot(getClientSummaryStoreForSource(sourceKey), (current) =>
    applyProjectsCollectionSnapshot(current, input, requestStartedAt),
  );
}

export function reportProjectCollectionSnapshot(
  sourceKey: ClientSummarySourceKey,
  input: ProjectCollectionSnapshot,
  requestStartedAt = Date.now(),
): void {
  updateStoreSnapshot(getClientSummaryStoreForSource(sourceKey), (current) =>
    applyProjectCollectionSnapshot(current, input, requestStartedAt),
  );
}

export function reportProjectQueueCollectionSnapshot(
  sourceKey: ClientSummarySourceKey,
  input: ProjectQueueCollectionSnapshot,
  requestStartedAt = Date.now(),
): void {
  updateStoreSnapshot(getClientSummaryStoreForSource(sourceKey), (current) =>
    applyProjectQueueCollectionSnapshot(current, input, requestStartedAt),
  );
}

export function reportSessionCollectionCreated(
  event: SessionCreatedEvent,
  observedAt = Date.now(),
): void {
  updateCurrentSnapshot((current) =>
    applySessionCollectionCreated(current, event, observedAt),
  );
}

export function reportSessionCollectionMetadataChanged(
  event: SessionMetadataChangedEvent,
  observedAt = Date.now(),
): void {
  updateCurrentSnapshot((current) =>
    applySessionCollectionMetadataChanged(current, event, observedAt),
  );
}

export function useClientSummaryState(): ClientSummaryState {
  useClientSummaryActivitySubscription();
  const store = useCurrentClientSummaryStore();
  return useStore(store);
}

export function useSessionCollectionRecord(
  sessionId: string | null | undefined,
): SessionCollectionRecord | undefined {
  useClientSummaryActivitySubscription();
  const store = useCurrentClientSummaryStore();
  return useStore(store, (state) =>
    selectSessionCollectionRecord(state, sessionId),
  );
}

export function useProjectCollectionRecord(
  projectId: string | null | undefined,
): ProjectCollectionRecord | undefined {
  useClientSummaryActivitySubscription();
  const store = useCurrentClientSummaryStore();
  return useStore(store, (state) =>
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
  const store = useCurrentClientSummaryStore();
  const byProject = useStore(store, (state) => state.projectQueues.byProject);
  const projectIdsKey = projectIds.join("\0");
  const selectedProjectIds = useMemo(() => [...projectIds], [projectIdsKey]);
  return useMemo(
    () =>
      selectProjectQueueItemsByProject(
        {
          ...store.getState(),
          projectQueues: { byProject },
        },
        selectedProjectIds,
      ),
    [store, byProject, selectedProjectIds],
  );
}

export function useProjectQueuedSessionIds(
  projectIds: readonly string[],
): ReadonlySet<string> {
  useClientSummaryActivitySubscription();
  const store = useCurrentClientSummaryStore();
  const byProject = useStore(store, (state) => state.projectQueues.byProject);
  const projectIdsKey = projectIds.join("\0");
  const selectedProjectIds = useMemo(() => [...projectIds], [projectIdsKey]);
  return useMemo(
    () =>
      selectProjectQueuedSessionIds(
        {
          ...store.getState(),
          projectQueues: { byProject },
        },
        selectedProjectIds,
      ),
    [store, byProject, selectedProjectIds],
  );
}

export function useDraftSessionIds(): ReadonlySet<string> {
  useDraftDecorationSubscription();
  const store = useCurrentClientSummaryStore();
  return useStore(store, selectDraftSessionIds);
}

export function useInboxResponseSnapshot(): InboxCollectionSnapshot {
  const state = useClientSummaryState();
  return useMemo(() => selectInboxResponse(state), [state]);
}

export function useInboxCounts(): InboxCounts {
  useClientSummaryActivitySubscription();
  const store = useCurrentClientSummaryStore();
  const needsAttention = useStore(
    store,
    (state) => state.inbox.tiers.needsAttention.length,
  );
  const active = useStore(
    store,
    (state) => state.inbox.tiers.active.length,
  );
  const total = useStore(
    store,
    (state) => selectInboxCounts(state).total,
  );
  return useMemo(
    () => ({ needsAttention, active, total }),
    [needsAttention, active, total],
  );
}

export function useInboxCountsByProject(): ReadonlyMap<string, InboxCounts> {
  useClientSummaryActivitySubscription();
  const store = useCurrentClientSummaryStore();
  const tiers = useStore(store, (state) => state.inbox.tiers);
  const entities = useStore(store, (state) => state.sessions.entities);
  return useMemo(() => {
    const state = store.getState();
    return selectInboxCountsByProject({
      ...state,
      sessions: { ...state.sessions, entities },
      inbox: { ...state.inbox, tiers },
    });
  }, [store, tiers, entities]);
}

export function useActiveProjectSessionIds(
  projectId: string | null | undefined,
): readonly string[] {
  useClientSummaryActivitySubscription();
  const store = useCurrentClientSummaryStore();
  const tiers = useStore(store, (state) => state.inbox.tiers);
  const entities = useStore(store, (state) => state.sessions.entities);
  return useMemo(() => {
    const state = store.getState();
    return selectActiveProjectSessionIds(
      {
        ...state,
        sessions: { ...state.sessions, entities },
        inbox: { ...state.inbox, tiers },
      },
      projectId,
    );
  }, [store, tiers, entities, projectId]);
}

export function useActiveAgentCount(): number {
  useClientSummaryActivitySubscription();
  const store = useCurrentClientSummaryStore();
  return useStore(store, selectActiveAgentCount);
}

export function useHasActiveAgents(): boolean {
  useClientSummaryActivitySubscription();
  const store = useCurrentClientSummaryStore();
  return useStore(store, selectHasActiveAgents);
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
  const store = useCurrentClientSummaryStore();
  return useStore(store, (state) =>
    selectSessionCollectionQueryState(state, query),
  );
}

export function resetClientSummaryStoreForTests(): void {
  for (const store of clientSummaryStoresBySource.values()) {
    store.setState(createEmptyClientSummaryState(), true);
  }
  clientSummaryStoresBySource.clear();
  currentClientSummarySourceKey = LOCAL_CLIENT_SUMMARY_SOURCE_KEY;
  currentSourceKeyListeners.clear();
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
