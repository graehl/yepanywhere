/**
 * Play for public share viewers: the shared HTML with its directly referenced
 * stylesheets, scripts, images, and media inlined as data URLs, so a
 * sandboxed opaque-origin frame can run it with no network reach back to the
 * share. Assets the share does not serve stay as written and simply fail to
 * load inside the sandbox.
 *
 * The play document is the hosted static `play.html`, addressed by a plain
 * URL that carries the same share grant as the file link: relay coordinates
 * in the query and the secret in the fragment, which never reaches a static
 * host's access log. That makes a play link copyable and shareable as-is.
 */
import { DEFAULT_RELAY_URL, normalizeRelayUrl } from "@yep-anywhere/shared";

const INLINE_ATTRIBUTES: ReadonlyArray<[selector: string, attribute: string]> =
  [
    ["link[rel~='stylesheet'][href]", "href"],
    ["link[rel~='icon'][href]", "href"],
    ["script[src]", "src"],
    ["img[src]", "src"],
    ["source[src]", "src"],
    ["video[src]", "src"],
    ["audio[src]", "src"],
    ["video[poster]", "poster"],
  ];
const MAX_INLINED_BYTES = 48 * 1024 * 1024;

export interface PublicSharePlayTarget {
  relayUsername: string;
  /** Omitted or default relay adds no `r` parameter, as share links do. */
  relayUrl?: string;
  secret: string;
  projectId: string;
  path: string;
}

/** `play.html` beneath the hosted client's base, carrying the share grant. */
export function buildPublicSharePlayUrl(
  basePath: string,
  target: PublicSharePlayTarget,
): string {
  const params = new URLSearchParams({
    h: target.relayUsername,
    projectId: target.projectId,
    path: target.path,
  });
  if (target.relayUrl) {
    const relayUrl = normalizeRelayUrl(target.relayUrl);
    if (relayUrl !== DEFAULT_RELAY_URL) params.set("r", relayUrl);
  }
  const hash = new URLSearchParams({ share: target.secret });
  return `${basePath}/play.html?${params}#${hash}`;
}

/** Read the target back out of a play URL; null when it is not one. */
export function parsePublicSharePlayUrl(
  href: string,
): PublicSharePlayTarget | null {
  let url: URL;
  try {
    url = new URL(href, "http://play.local");
  } catch {
    return null;
  }
  const secret = new URLSearchParams(url.hash.slice(1)).get("share");
  const relayUsername = url.searchParams.get("h");
  const projectId = url.searchParams.get("projectId");
  const path = url.searchParams.get("path");
  if (!secret || !relayUsername || !projectId || !path) return null;
  const relayUrl = url.searchParams.get("r") ?? undefined;
  return {
    secret,
    relayUsername,
    projectId,
    path,
    ...(relayUrl ? { relayUrl } : {}),
  };
}

/**
 * The play counterpart of a public file share link, or null when the link is
 * not a file share. Keeps the link's origin and its `/remote` prefix.
 */
export function publicSharePlayUrlFromFileShareUrl(
  shareUrl: string,
): string | null {
  let url: URL;
  try {
    url = new URL(shareUrl);
  } catch {
    return null;
  }
  const match = /^(\/remote)?\/share\/([A-Za-z0-9_-]+)\/file$/.exec(
    url.pathname,
  );
  const relayUsername = url.searchParams.get("h");
  const projectId = url.searchParams.get("projectId");
  const path = url.searchParams.get("path");
  if (!match || !relayUsername || !projectId || !path) return null;
  const relayUrl = url.searchParams.get("r") ?? undefined;
  return `${url.origin}${buildPublicSharePlayUrl(match[1] ?? "", {
    relayUsername,
    projectId,
    path,
    secret: match[2]!,
    ...(relayUrl ? { relayUrl } : {}),
  })}`;
}

/** Local reference the share can serve: relative, no scheme, no host. */
export function isInlinableReference(reference: string): boolean {
  const trimmed = reference.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//"))
    return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

/** Resolve a reference against the root file's project-relative directory. */
export function resolveShareReference(
  rootPath: string,
  reference: string,
): string {
  const clean = reference.trim().split(/[?#]/, 1)[0] ?? "";
  const base = clean.startsWith("/")
    ? []
    : rootPath.split("/").slice(0, -1).filter(Boolean);
  const parts = [...base];
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/**
 * A srcdoc document resolves URLs against the embedding play page, so a
 * `#section` link would navigate the frame to `play.html` without its share
 * grant instead of scrolling. Pages also create such links at runtime, which
 * a static rewrite would miss, so fragment-only links are resolved at click
 * time on the frame's own `about:srcdoc` location. It listens on the window,
 * after every page handler, and yields to one that already took the click.
 */
export const KEEP_FRAGMENT_LINKS_IN_FRAME_SCRIPT = `window.addEventListener("click",function(e){if(e.defaultPrevented||!(e.target instanceof Element))return;var a=e.target.closest("a[href],area[href]");if(!a)return;var h=a.getAttribute("href").trim();if(h.charAt(0)!=="#")return;e.preventDefault();location.hash=h;});`;

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export async function buildPlayableHtml(
  html: string,
  rootPath: string,
  fetchAsset: (projectRelativePath: string) => Promise<Blob>,
): Promise<string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const base of doc.querySelectorAll("base")) base.remove();
  const keepFragments = doc.createElement("script");
  keepFragments.textContent = KEEP_FRAGMENT_LINKS_IN_FRAME_SCRIPT;
  doc.head.prepend(keepFragments);
  let inlined = 0;
  const cache = new Map<string, Promise<string | null>>();
  const inline = (path: string) => {
    let pending = cache.get(path);
    if (!pending) {
      pending = fetchAsset(path)
        .then(async (blob) => {
          if (inlined + blob.size > MAX_INLINED_BYTES) return null;
          inlined += blob.size;
          return await toDataUrl(blob);
        })
        .catch(() => null);
      cache.set(path, pending);
    }
    return pending;
  };
  const work: Promise<void>[] = [];
  for (const [selector, attribute] of INLINE_ATTRIBUTES) {
    for (const element of doc.querySelectorAll(selector)) {
      const reference = element.getAttribute(attribute);
      if (!reference || !isInlinableReference(reference)) continue;
      const path = resolveShareReference(rootPath, reference);
      work.push(
        inline(path).then((dataUrl) => {
          if (dataUrl) element.setAttribute(attribute, dataUrl);
        }),
      );
    }
  }
  await Promise.all(work);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
