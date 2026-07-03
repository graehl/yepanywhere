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
}

export function prepareWarmRefreshBeforeHydration({
  warmLoad,
  refreshMessages,
  refreshSession,
}: {
  warmLoad: SessionRouteSnapshot;
  refreshMessages: Message[];
  refreshSession: SessionMetadata;
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
  };
}

export function prepareWarmRefreshAfterHydration({
  warmLoad,
  latestSnapshot,
  refreshMessages,
  refreshSession,
}: {
  warmLoad: SessionRouteSnapshot;
  latestSnapshot: Pick<SessionRouteSnapshot, "messages"> | undefined;
  refreshMessages: Message[];
  refreshSession: SessionMetadata;
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
  };
}
