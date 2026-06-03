const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, "");

/**
 * Convert a React Router app path into a browser URL for raw href/window.open.
 * React Router adds basename for <Link>/navigate, but raw browser APIs do not.
 */
export function toBrowserAppHref(routerPath: string): string {
  const path = routerPath.startsWith("/") ? routerPath : `/${routerPath}`;
  return `${ROUTER_BASENAME}${path}`;
}
