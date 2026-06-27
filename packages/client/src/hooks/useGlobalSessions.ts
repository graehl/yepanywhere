import { useMemo } from "react";
import type { GlobalSessionItem } from "../api/client";
import { useSessionCollectionQueryRecords } from "../lib/sessionCollectionExternalStore";
import { sessionCollectionRecordsToGlobalSessionItems } from "../lib/sessionCollectionRecords";
import type { ProcessStateEvent } from "./useFileActivity";
import {
  type UseGlobalSessionsFeedResult,
  type UseGlobalSessionsOptions,
  useGlobalSessionsFeed,
} from "./useGlobalSessionsFeed";

export type { UseGlobalSessionsOptions } from "./useGlobalSessionsFeed";
export { DEFAULT_GLOBAL_SESSION_STATS } from "./useGlobalSessionsFeed";

export function reconcileGlobalSessionsProcessState(
  sessions: GlobalSessionItem[],
  event: ProcessStateEvent,
): { sessions: GlobalSessionItem[]; matched: boolean } {
  let matched = false;

  const activity =
    event.activity === "in-turn" || event.activity === "waiting-input"
      ? event.activity
      : undefined;
  const pendingInputType =
    event.activity === "waiting-input" ? event.pendingInputType : undefined;

  const reconciled = sessions.map((session) => {
    if (session.id !== event.sessionId) {
      return session;
    }

    matched = true;
    return {
      ...session,
      activity,
      pendingInputType,
    };
  });

  return {
    sessions: reconciled,
    matched,
  };
}

export function shouldRefetchGlobalSessionsAfterProcessState(
  event: ProcessStateEvent,
  matched: boolean,
): boolean {
  return !matched || event.activity !== "in-turn";
}

export function useGlobalSessions(
  options: UseGlobalSessionsOptions = {},
): UseGlobalSessionsFeedResult & { sessions: GlobalSessionItem[] } {
  const feed = useGlobalSessionsFeed(options);
  const records = useSessionCollectionQueryRecords(feed.query);
  const sessions = useMemo(
    () => sessionCollectionRecordsToGlobalSessionItems(records),
    [records],
  );

  return {
    ...feed,
    sessions,
  };
}
