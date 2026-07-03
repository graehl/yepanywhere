import { useLayoutEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  getCurrentClientSummarySourceKey,
  LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
  REMOTE_NONE_CLIENT_SUMMARY_SOURCE_KEY,
  setCurrentClientSummarySourceKey,
  type ClientSummarySourceKey,
} from "../lib/clientSummaryStore";
import { getHostById, getHostByRelayUsername } from "../lib/hostStorage";
import {
  resolveSourceKeyForDirectUrl,
  resolveSourceKeyForSavedHost,
} from "../lib/sourceIdentity";
import { useOptionalRemoteConnection } from "./RemoteConnectionContext";

const DIRECT_ROUTE_SEGMENTS = new Set([
  "",
  "activity",
  "agents",
  "devices",
  "git-status",
  "inbox",
  "new-session",
  "projects",
  "sessions",
  "settings",
]);

const NON_HOST_ROUTE_SEGMENTS = new Set(["login", "remote", "share"]);

export interface ClientSummarySourceRemoteState {
  currentDirectUrl: string | null;
  currentHostId: string | null;
}

function firstPathSegment(pathname: string): string {
  const rawSegment = pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  try {
    return decodeURIComponent(rawSegment);
  } catch {
    return rawSegment;
  }
}

export function resolveClientSummarySourceKey(options: {
  pathname: string;
  remote: ClientSummarySourceRemoteState | null;
}): ClientSummarySourceKey {
  const { pathname, remote } = options;
  if (!remote) {
    return LOCAL_CLIENT_SUMMARY_SOURCE_KEY;
  }

  const segment = firstPathSegment(pathname);
  if (NON_HOST_ROUTE_SEGMENTS.has(segment)) {
    return REMOTE_NONE_CLIENT_SUMMARY_SOURCE_KEY;
  }

  if (!DIRECT_ROUTE_SEGMENTS.has(segment)) {
    const host = getHostByRelayUsername(segment);
    return host
      ? resolveSourceKeyForSavedHost(host)
      : REMOTE_NONE_CLIENT_SUMMARY_SOURCE_KEY;
  }

  const currentHost = remote.currentHostId
    ? getHostById(remote.currentHostId)
    : undefined;
  if (currentHost?.mode === "direct") {
    return resolveSourceKeyForSavedHost(currentHost);
  }

  if (remote.currentDirectUrl) {
    return resolveSourceKeyForDirectUrl(remote.currentDirectUrl);
  }

  return REMOTE_NONE_CLIENT_SUMMARY_SOURCE_KEY;
}

export function ClientSummarySourceBinding(): null {
  const remote = useOptionalRemoteConnection();
  const location = useLocation();
  const hasRemote = remote !== null;
  const currentDirectUrl = remote?.currentDirectUrl ?? null;
  const currentHostId = remote?.currentHostId ?? null;
  const sourceKey = useMemo(
    () =>
      resolveClientSummarySourceKey({
        pathname: location.pathname,
        remote: hasRemote
          ? {
              currentDirectUrl,
              currentHostId,
            }
          : null,
      }),
    [currentDirectUrl, currentHostId, hasRemote, location.pathname],
  );

  if (getCurrentClientSummarySourceKey() !== sourceKey) {
    setCurrentClientSummarySourceKey(sourceKey);
  }

  useLayoutEffect(() => {
    setCurrentClientSummarySourceKey(sourceKey);
  }, [sourceKey]);

  return null;
}
