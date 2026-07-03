import type { PaginationInfo } from "../../api/client";
import type { Message, SessionMetadata } from "../../types";
import type { SessionRouteSnapshot } from "../sessionRouteSnapshots";
import {
  mergePersistedMessagesForProvider,
  reconcilePersistedMessagesForProvider,
  tagJsonlMessages,
} from "./transcriptReducer";

export interface WarmRefreshPreparation {
  taggedMessages: Message[];
  mergedMessages: Message[];
  pagination?: PaginationInfo;
}

export function reconcileWarmRefreshPagination(
  warmPagination: PaginationInfo | undefined,
  refreshPagination: PaginationInfo | undefined,
  mergedMessages: readonly Message[],
): PaginationInfo | undefined {
  if (!refreshPagination) {
    return warmPagination;
  }
  if (
    warmPagination?.hasOlderMessages === false &&
    refreshPagination.hasOlderMessages &&
    mergedMessages.length > refreshPagination.returnedMessageCount
  ) {
    return {
      ...refreshPagination,
      hasOlderMessages: false,
      returnedMessageCount: Math.max(
        mergedMessages.length,
        refreshPagination.returnedMessageCount,
      ),
      totalMessageCount: Math.max(
        warmPagination.totalMessageCount,
        refreshPagination.totalMessageCount,
        mergedMessages.length,
      ),
      truncatedBeforeMessageId: undefined,
      truncatedBy: undefined,
    };
  }
  return refreshPagination;
}

export function prepareWarmRefreshBeforeHydration({
  warmLoad,
  refreshMessages,
  refreshSession,
  refreshPagination,
}: {
  warmLoad: SessionRouteSnapshot;
  refreshMessages: Message[];
  refreshSession: SessionMetadata;
  refreshPagination?: PaginationInfo;
}): WarmRefreshPreparation {
  const taggedMessages = tagJsonlMessages(refreshMessages);
  const mergedMessages = warmLoad.lastMessageId
    ? mergePersistedMessagesForProvider(
        warmLoad.messages,
        taggedMessages,
        refreshSession.provider,
      )
    : reconcilePersistedMessagesForProvider(
        taggedMessages,
        refreshSession.provider,
      );
  return {
    taggedMessages,
    mergedMessages,
    pagination: reconcileWarmRefreshPagination(
      warmLoad.pagination,
      refreshPagination,
      mergedMessages,
    ),
  };
}

export function prepareWarmRefreshAfterHydration({
  warmLoad,
  latestSnapshot,
  refreshMessages,
  refreshSession,
  refreshPagination,
}: {
  warmLoad: SessionRouteSnapshot;
  latestSnapshot: Pick<SessionRouteSnapshot, "messages"> | undefined;
  refreshMessages: Message[];
  refreshSession: SessionMetadata;
  refreshPagination?: PaginationInfo;
}): WarmRefreshPreparation {
  const taggedMessages = tagJsonlMessages(refreshMessages);
  const baseMessages =
    latestSnapshot && latestSnapshot.messages.length > 0
      ? latestSnapshot.messages
      : warmLoad.messages;
  const mergedMessages = mergePersistedMessagesForProvider(
    baseMessages,
    taggedMessages,
    refreshSession.provider,
  );
  return {
    taggedMessages,
    mergedMessages,
    pagination: reconcileWarmRefreshPagination(
      warmLoad.pagination,
      refreshPagination,
      mergedMessages,
    ),
  };
}
