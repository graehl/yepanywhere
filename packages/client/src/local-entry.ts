import { primeLocalRoute } from "./lib/localRouteBootstrap";

// This entry belongs only to the same-origin local client. Remote entrypoints
// acquire data after their source transport is connected. Keep UI imports
// asynchronous so local HTTP reads can overlap the React runtime download.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");
const initialPath = window.location.pathname.slice(basename.length);
const wrongDevPort =
  import.meta.env.DEV && window.location.port === String(__VITE_DEV_PORT__);
const initialNewSession = /^\/new-session\/?$/.test(initialPath);
const initialSettings = /^\/settings(?:\/|$)/.test(initialPath);
if (!wrongDevPort && (initialNewSession || initialSettings)) {
  void primeLocalRoute(
    initialNewSession ? "new-session" : "settings",
    new URLSearchParams(window.location.search).get("provider"),
  );
}

void import("./main");
