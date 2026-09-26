import type { ArtifactViewerStatus } from "@yep-anywhere/shared";

/**
 * The URL a framed artifact may have opened in a new tab: a file of the same
 * grant the frame was given, plain or as an explicit download. Anything else,
 * including another grant or origin, is refused with `undefined`.
 */
export function artifactTabUrl(
  requested: string,
  grantUrl: string,
): string | undefined {
  let url: URL;
  let grant: URL;
  try {
    url = new URL(requested);
    grant = new URL(grantUrl);
  } catch {
    return;
  }
  const token = /^\/a\/[A-Za-z0-9_-]+\//.exec(grant.pathname)?.[0];
  if (
    !token ||
    url.origin !== grant.origin ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(token) ||
    url.pathname.length === token.length ||
    !["", "?download=true"].includes(url.search)
  )
    return;
  url.hash = "";
  return url.href;
}

export function artifactAudience(hostname: string): "local" | "public" {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    ? "local"
    : "public";
}

export function artifactOrigin(
  config: ArtifactViewerStatus,
  audience: "local" | "public",
  clientUrl: string,
): string | undefined {
  const value = audience === "local" ? config.localOrigin : config.publicOrigin;
  if (!value) return;
  const origin = new URL(value);
  const client = new URL(clientUrl);
  if (
    origin.hostname === client.hostname ||
    !["http:", "https:"].includes(origin.protocol) ||
    (client.protocol === "https:" && origin.protocol !== "https:")
  )
    return;
  return origin.origin;
}

/** Only configured, isolated grant URLs are eligible for in-session viewing. */
export function isArtifactLink(
  href: string,
  config: ArtifactViewerStatus | undefined,
  clientUrl: string,
): boolean {
  if (!config) return false;
  let url: URL;
  try {
    url = new URL(href, clientUrl);
  } catch {
    return false;
  }
  return (
    !url.username &&
    !url.password &&
    /^\/a\/[A-Za-z0-9_-]+\/.+/.test(url.pathname) &&
    (["local", "public"] as const).some(
      (audience) => url.origin === artifactOrigin(config, audience, clientUrl),
    )
  );
}

/** No YA transport, credentials, grant token, or referrer crosses this probe. */
export async function probeArtifactOrigin(
  origin: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${origin}/health`, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!response.ok || (await response.json()).artifactViewer !== 1) {
    throw new Error("Artifact origin is unavailable");
  }
}
