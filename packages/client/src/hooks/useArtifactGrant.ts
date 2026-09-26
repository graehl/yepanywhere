import {
  serverHasCapability,
  SERVER_CAPABILITIES,
  type ArtifactViewerGrant,
} from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import { usePublicShareContext } from "../contexts/PublicShareContext";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import {
  artifactAudience,
  artifactOrigin,
  probeArtifactOrigin,
} from "../lib/artifactPreview";
import { useRetainedVersionInfo } from "./useVersion";

export interface ArtifactGrantState {
  /** Configured artifact origin for this client, or undefined when unusable. */
  origin: string | undefined;
  grant: ArtifactViewerGrant | null;
  busy: boolean;
  failed: boolean;
  /** The page's frame-src policy rejected the artifact origin. */
  frameBlocked: boolean;
}

/**
 * Resolve an artifact grant for one file on the configured artifact origin.
 * `attempt` 0 holds no grant; each increment probes the origin and admits a
 * fresh grant. Public shares and servers without the capability never resolve.
 */
export function useArtifactGrant(
  path: string,
  projectId: string | undefined,
  attempt: number,
): ArtifactGrantState {
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  const share = usePublicShareContext();
  const config = version?.artifactViewer;
  const audience = artifactAudience(window.location.hostname);
  const origin =
    config &&
    share === null &&
    serverHasCapability(version, SERVER_CAPABILITIES.artifactViewer.name)
      ? artifactOrigin(config, audience, window.location.href)
      : undefined;
  const [grant, setGrant] = useState<ArtifactViewerGrant | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frameBlocked, setFrameBlocked] = useState(false);

  useEffect(() => {
    setGrant(null);
    setFailed(false);
    setBusy(false);
    setFrameBlocked(false);
    if (!attempt || !origin) return;
    let cancelled = false;
    let admitted: ArtifactViewerGrant | undefined;
    const onPolicyViolation = (event: SecurityPolicyViolationEvent) => {
      if (
        admitted &&
        event.disposition === "enforce" &&
        event.effectiveDirective === "frame-src" &&
        (event.blockedURI === origin ||
          event.blockedURI.startsWith(`${origin}/`))
      ) {
        setFrameBlocked(true);
      }
    };
    document.addEventListener("securitypolicyviolation", onPolicyViolation);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    setBusy(true);
    const revokeUnpublished = (id: string) => {
      void runtime.transport
        .fetch(`/artifacts/${encodeURIComponent(id)}`, { method: "DELETE" })
        .catch(() => {});
    };
    void (async () => {
      try {
        await probeArtifactOrigin(origin, controller.signal);
        clearTimeout(timer);
        if (cancelled) return;
        admitted = await runtime.transport.fetch<ArtifactViewerGrant>(
          "/artifacts",
          {
            method: "POST",
            body: JSON.stringify({ path, projectId, audience }),
          },
        );
        if (new URL(admitted.url).origin !== origin) {
          revokeUnpublished(admitted.id);
          throw new Error("Unexpected artifact origin");
        }
        if (cancelled) {
          revokeUnpublished(admitted.id);
          return;
        }
        setGrant(admitted);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        clearTimeout(timer);
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener(
        "securitypolicyviolation",
        onPolicyViolation,
      );
    };
  }, [attempt, origin, audience, path, projectId, runtime]);

  return { origin, grant, busy, failed, frameBlocked };
}
