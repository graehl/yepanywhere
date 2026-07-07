export interface RemoteRouteLocationParts {
  pathname: string;
  search?: string;
  hash?: string;
}

const DIRECT_APP_ROUTE_SEGMENTS = new Set([
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

function isDirectAppRoutePath(pathname: string): boolean {
  if (pathname === "/") return true;
  const firstSegment = pathname.split("/")[1];
  return firstSegment ? DIRECT_APP_ROUTE_SEGMENTS.has(firstSegment) : false;
}

function formatRouteTarget(location: RemoteRouteLocationParts): string {
  return `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`;
}

function parseSafeRouteTarget(
  target: string | null | undefined,
): RemoteRouteLocationParts | null {
  if (!target?.startsWith("/") || target.startsWith("//")) return null;

  const hashIndex = target.indexOf("#");
  const beforeHash = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : target.slice(hashIndex);
  const searchIndex = beforeHash.indexOf("?");
  const pathname =
    searchIndex === -1 ? beforeHash : beforeHash.slice(0, searchIndex);
  const search = searchIndex === -1 ? "" : beforeHash.slice(searchIndex);

  return { pathname: pathname || "/", search, hash };
}

export function getRelayCanonicalRedirectTarget(
  location: RemoteRouteLocationParts,
  relayUsername: string | null | undefined,
): string | null {
  if (!relayUsername) return null;

  const encodedRelayUsername = encodeURIComponent(relayUsername);
  const pathname = location.pathname === "/" ? "/projects" : location.pathname;
  const relayPrefix = `/${encodedRelayUsername}`;

  if (!isDirectAppRoutePath(pathname)) {
    return null;
  }

  if (pathname === relayPrefix || pathname.startsWith(`${relayPrefix}/`)) {
    return null;
  }

  return `${relayPrefix}${pathname}${location.search ?? ""}${location.hash ?? ""}`;
}

export function getSafeRemoteReturnTarget(
  returnTo: string | null | undefined,
  relayUsername: string | null | undefined,
): string | null {
  const target = parseSafeRouteTarget(returnTo);
  if (!target) return null;

  if (
    target.pathname === "/login" ||
    target.pathname.startsWith("/login/")
  ) {
    return null;
  }

  return (
    getRelayCanonicalRedirectTarget(target, relayUsername) ??
    formatRouteTarget(target)
  );
}
