import { useEffect, useRef } from "react";
import type { StagedAttachmentRef } from "@yep-anywhere/shared";
import type { DraftAttachmentState } from "./draftEnvelope";

export interface AttachmentNavigationRiskInput {
  pendingUploadCount?: number;
  transientAttachmentCount?: number;
  stagedRefs?: readonly StagedAttachmentRef[];
  draftState?: DraftAttachmentState | null;
}

export function hasAttachmentNavigationRisk({
  pendingUploadCount = 0,
  transientAttachmentCount = 0,
  stagedRefs = [],
  draftState = null,
}: AttachmentNavigationRiskInput): boolean {
  if (pendingUploadCount > 0 || transientAttachmentCount > 0) {
    return true;
  }

  if (stagedRefs.length === 0) {
    return false;
  }

  if (!draftState || draftState.refs.length === 0) {
    return true;
  }

  const draftRefIds = new Set(draftState.refs.map((ref) => ref.id));
  return stagedRefs.some(
    (ref) => ref.batchId !== draftState.batchId || !draftRefIds.has(ref.id),
  );
}

export function useAttachmentNavigationGuard(shouldWarn: boolean): void {
  const shouldWarnRef = useRef(shouldWarn);

  useEffect(() => {
    shouldWarnRef.current = shouldWarn;
  }, [shouldWarn]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldWarnRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);
}
