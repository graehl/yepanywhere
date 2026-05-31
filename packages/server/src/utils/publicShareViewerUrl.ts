const DEFAULT_PUBLIC_SHARE_VIEWER_BASE_URL =
  "https://yepanywhere.com/remote/share";

const NEW_VIEWER_BASE_URL_ENV = "YEP_PUBLIC_SHARE_VIEWER_BASE_URL";
const LEGACY_VIEWER_ORIGIN_ENV = "YEP_PUBLIC_SHARE_ORIGIN";

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getDefaultPublicShareViewerBaseUrl(): string {
  return DEFAULT_PUBLIC_SHARE_VIEWER_BASE_URL;
}

export function normalizePublicShareViewerBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Public share viewer URL is required");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Public share viewer URL must be a valid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Public share viewer URL must use http:// or https://");
  }
  if (url.username || url.password) {
    throw new Error("Public share viewer URL must not include credentials");
  }
  if (url.search || url.hash) {
    throw new Error("Public share viewer URL must not include query or hash");
  }

  const path = trimTrailingSlashes(url.pathname);
  return `${url.origin}${path === "" ? "" : path}`;
}

function normalizeLegacyPublicShareOrigin(raw: string): string {
  const normalized = normalizePublicShareViewerBaseUrl(raw);
  const url = new URL(normalized);
  const path = trimTrailingSlashes(url.pathname);
  if (!path) {
    return `${url.origin}/share`;
  }
  return normalized;
}

export function resolvePublicShareViewerBaseUrl(
  configured?: string | null,
): string {
  if (configured) {
    return normalizePublicShareViewerBaseUrl(configured);
  }

  const envBaseUrl = process.env[NEW_VIEWER_BASE_URL_ENV];
  if (envBaseUrl) {
    return normalizePublicShareViewerBaseUrl(envBaseUrl);
  }

  const legacyOrigin = process.env[LEGACY_VIEWER_ORIGIN_ENV];
  if (legacyOrigin) {
    return normalizeLegacyPublicShareOrigin(legacyOrigin);
  }

  return DEFAULT_PUBLIC_SHARE_VIEWER_BASE_URL;
}

export function buildPublicShareViewerUrl(
  secret: string,
  viewerBaseUrl: string,
): string {
  const normalized = normalizePublicShareViewerBaseUrl(viewerBaseUrl);
  return `${normalized}/${encodeURIComponent(secret)}`;
}
