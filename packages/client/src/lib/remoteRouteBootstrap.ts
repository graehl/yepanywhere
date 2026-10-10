import type { ClientSummarySourceKey } from "./clientSourceIdentity";
import type { SourceTransport } from "./transport/types";
import { primeRoute } from "./routeBootstrap";

/** Acquire the connected route before publishing its source to mounted UI. */
export function primeRemoteRoute(
  sourceKey: ClientSummarySourceKey,
  transport: Pick<SourceTransport, "fetch" | "fetchStream">,
  location: Pick<Location, "pathname" | "search">,
  baseUrl: string,
) {
  const base = baseUrl.replace(/\/$/, "");
  const pathname = location.pathname
    .slice(base.length)
    .replace(/^\/-\/relay\/[^/]+/, "");
  const route = /^\/new-session\/?$/.test(pathname)
    ? "new-session"
    : /^\/settings(?:\/|$)/.test(pathname)
      ? "settings"
      : null;
  if (!route) return;
  return primeRoute(
    sourceKey,
    transport,
    route,
    new URLSearchParams(location.search).get("provider"),
  );
}
