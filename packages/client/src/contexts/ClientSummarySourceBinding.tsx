import { useLayoutEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  createClientSummaryDirectSourceKey,
  createClientSummaryHostSourceKey,
  getCurrentClientSummarySourceKey,
  LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
  REMOTE_NONE_CLIENT_SUMMARY_SOURCE_KEY,
  setCurrentClientSummarySourceKey,
  type ClientSummarySourceKey,
} from "../lib/clientSummaryStore";
import { getHostById, getHostByRelayUsername } from "../lib/hostStorage";
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

function normalizeDirectSourceUrl(wsUrl: string): string {
  const trimmed = wsUrl.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString();
  } catch {
    return trimmed;
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
      ? createClientSummaryHostSourceKey(host.id)
      : REMOTE_NONE_CLIENT_SUMMARY_SOURCE_KEY;
  }

  const currentHost = remote.currentHostId
    ? getHostById(remote.currentHostId)
    : undefined;
  if (currentHost?.mode === "direct") {
    return createClientSummaryHostSourceKey(currentHost.id);
  }

  if (remote.currentDirectUrl) {
    return createClientSummaryDirectSourceKey(
      normalizeDirectSourceUrl(remote.currentDirectUrl),
    );
  }

  return REMOTE_NONE_CLIENT_SUMMARY_SOURCE_KEY;
}

export function ClientSummarySourceBinding(): null {
  const remote = useOptionalRemoteConnection();
  const location = useLocation();
  const sourceKey = useMemo(
    () =>
      resolveClientSummarySourceKey({
        pathname: location.pathname,
        remote: remote
          ? {
              currentDirectUrl: remote.currentDirectUrl,
              currentHostId: remote.currentHostId,
            }
          : null,
      }),
    [location.pathname, remote?.currentDirectUrl, remote?.currentHostId],
  );

  if (getCurrentClientSummarySourceKey() !== sourceKey) {
    setCurrentClientSummarySourceKey(sourceKey);
  }

  useLayoutEffect(() => {
    setCurrentClientSummarySourceKey(sourceKey);
  }, [sourceKey]);

  return null;
}
