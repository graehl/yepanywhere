import { fetchPlainJSON, fetchPlainResponse } from "../api/plainFetch";
import { LOCAL_CLIENT_SUMMARY_SOURCE_KEY } from "./clientSourceIdentity";
import { primeRoute } from "./routeBootstrap";

/** Keep the local entry independent of React and the remote transport graph. */
export function primeLocalRoute(
  route: "new-session" | "settings",
  preferredProvider: string | null,
) {
  return primeRoute(
    LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
    { fetch: fetchPlainJSON, fetchStream: fetchPlainResponse },
    route,
    preferredProvider,
  );
}
