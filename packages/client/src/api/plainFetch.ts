import { authEvents } from "../lib/authEvents";
import { getClientVersion } from "../lib/clientVersion";
import { type ApiRefusalFields, refusalFields } from "./refusal";
import { requestDeadlineSignal } from "./requestDeadline";

export const API_BASE = "/api";

/**
 * Desktop auth token read from URL query parameter (?desktop_token=...).
 * When present, sent as X-Desktop-Token header on same-origin API requests.
 */
let desktopAuthToken: string | null = null;
if (typeof window !== "undefined") {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("desktop_token");
  if (token) {
    desktopAuthToken = token;
    // Strip token from URL to keep it out of history/bookmarks.
    params.delete("desktop_token");
    const cleanUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}${window.location.hash}`
      : `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, "", cleanUrl);
  }
}

export function getDesktopAuthToken(): string | null {
  return desktopAuthToken;
}

type PlainFetchError = Error & {
  status: number;
  setupRequired?: boolean;
};

interface PlainFetchOptions {
  fetchImpl?: typeof fetch;
  apiBase?: string;
  desktopAuthToken?: string | null;
  onLoginRequired?: () => void;
}

function mergePlainHeaders(
  defaults: Record<string, string>,
  headers: HeadersInit | undefined,
): Headers {
  const merged = new Headers(defaults);
  if (headers) {
    for (const [key, value] of new Headers(headers)) {
      merged.set(key, value);
    }
  }
  return merged;
}

function createPlainFetchHeaders(
  headers: HeadersInit | undefined,
  options: PlainFetchOptions,
): Headers {
  const token = options.desktopAuthToken ?? desktopAuthToken;
  return mergePlainHeaders(
    {
      "Content-Type": "application/json",
      "X-Yep-Anywhere": "true",
      "X-Yep-Client-Version": getClientVersion(),
      ...(token ? { "X-Desktop-Token": token } : {}),
    },
    headers,
  );
}

async function getJsonErrorDetail(
  response: Response,
  fallback: string,
): Promise<{ message: string; refusal: ApiRefusalFields }> {
  try {
    const body = (await response.json()) as {
      error?: unknown;
      message?: unknown;
    };
    const refusal = refusalFields(body);
    if (body.error) return { message: String(body.error), refusal };
    if (body.message) return { message: String(body.message), refusal };
    return { message: fallback, refusal };
  } catch {
    // Response body was not JSON; keep the status fallback.
  }
  return { message: fallback, refusal: {} };
}

async function getBlobErrorMessage(response: Response): Promise<string> {
  let detail = "";
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("application/json")) {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) {
        detail = body.error.trim();
      }
    } else {
      detail = (await response.text()).trim();
    }
  } catch {
    detail = "";
  }

  const status = `${response.status} ${response.statusText}`.trim();
  return detail ? `API error: ${status}: ${detail}` : `API error: ${status}`;
}

function signalLoginRequired(
  path: string,
  onLoginRequired: (() => void) | undefined,
): void {
  if (path.startsWith("/auth/")) return;
  console.log("[API] 401 response, signaling login required");
  if (onLoginRequired) {
    onLoginRequired();
  } else {
    authEvents.signalLoginRequired();
  }
}

function createPlainFetchError(
  response: Response,
  message: string,
): PlainFetchError {
  const error = new Error(message) as PlainFetchError;
  error.status = response.status;
  if (response.headers.get("X-Setup-Required") === "true") {
    error.setupRequired = true;
  }
  return error;
}

export async function fetchPlainJSON<T>(
  path: string,
  requestInit?: RequestInit,
  options: PlainFetchOptions = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.apiBase ?? API_BASE}${path}`, {
    ...requestInit,
    credentials: "include",
    headers: createPlainFetchHeaders(requestInit?.headers, options),
    signal: requestDeadlineSignal(requestInit?.signal),
  });

  return readPlainJSONResponse<T>(path, response, options);
}

/** Apply the same refusal and login semantics to a bundled route response. */
export async function readPlainJSONResponse<T>(
  path: string,
  response: Response,
  options: PlainFetchOptions = {},
): Promise<T> {
  if (!response.ok) {
    if (response.status === 401) {
      signalLoginRequired(path, options.onLoginRequired);
    }

    const fallback = `API error: ${response.status} ${response.statusText}`;
    const { message, refusal } = await getJsonErrorDetail(response, fallback);
    throw Object.assign(createPlainFetchError(response, message), refusal);
  }

  return response.json();
}

export async function fetchPlainBlob(
  path: string,
  requestInit?: RequestInit,
  options: PlainFetchOptions = {},
): Promise<Blob> {
  const response = await fetchPlainResponse(path, requestInit, options);
  return response.blob();
}

/** Preserve response validators and bodyless conditional-GET replies. */
export async function fetchPlainResponse(
  path: string,
  requestInit?: RequestInit,
  options: PlainFetchOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.apiBase ?? API_BASE}${path}`, {
    ...requestInit,
    credentials: "include",
    headers: createPlainFetchHeaders(requestInit?.headers, options),
    signal: requestDeadlineSignal(requestInit?.signal),
  });

  if (!response.ok && response.status !== 304) {
    if (response.status === 401) {
      signalLoginRequired(path, options.onLoginRequired);
    }
    throw createPlainFetchError(response, await getBlobErrorMessage(response));
  }

  return response;
}
