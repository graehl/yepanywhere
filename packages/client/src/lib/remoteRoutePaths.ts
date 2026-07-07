export interface RemoteRouteLocationParts {
  pathname: string;
  search?: string;
  hash?: string;
}

export function getRelayCanonicalRedirectTarget(
  location: RemoteRouteLocationParts,
  relayUsername: string | null | undefined,
): string | null {
  if (!relayUsername) return null;

  const encodedRelayUsername = encodeURIComponent(relayUsername);
  const pathname = location.pathname === "/" ? "/projects" : location.pathname;
  const relayPrefix = `/${encodedRelayUsername}`;

  if (pathname === relayPrefix || pathname.startsWith(`${relayPrefix}/`)) {
    return null;
  }

  return `${relayPrefix}${pathname}${location.search ?? ""}${location.hash ?? ""}`;
}
