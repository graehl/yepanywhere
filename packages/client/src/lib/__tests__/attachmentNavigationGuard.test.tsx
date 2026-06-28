// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StagedAttachmentRef } from "@yep-anywhere/shared";
import {
  hasAttachmentNavigationRisk,
  useAttachmentNavigationGuard,
} from "../attachmentNavigationGuard";

const stagedRef: StagedAttachmentRef = {
  id: "staged-1",
  batchId: "batch-1",
  originalName: "notes.txt",
  name: "staged-1_notes.txt",
  size: 5,
  mimeType: "text/plain",
  createdAt: "2026-06-28T00:00:00.000Z",
  updatedAt: "2026-06-28T00:00:00.000Z",
};

function GuardHarness({ shouldWarn }: { shouldWarn: boolean }) {
  useAttachmentNavigationGuard(shouldWarn);
  return null;
}

function dispatchBeforeUnload(): {
  allowed: boolean;
  defaultPrevented: boolean;
} {
  const event = new Event("beforeunload", {
    cancelable: true,
  }) as BeforeUnloadEvent;
  const allowed = window.dispatchEvent(event);
  return { allowed, defaultPrevented: event.defaultPrevented };
}

describe("attachmentNavigationGuard", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not warn for staged refs persisted in the draft envelope", () => {
    expect(
      hasAttachmentNavigationRisk({
        stagedRefs: [stagedRef],
        draftState: {
          batchId: stagedRef.batchId,
          refs: [stagedRef],
          updatedAt: "2026-06-28T00:00:00.000Z",
        },
      }),
    ).toBe(false);
  });

  it("warns for attachment states that can still be lost", () => {
    expect(hasAttachmentNavigationRisk({ pendingUploadCount: 1 })).toBe(true);
    expect(hasAttachmentNavigationRisk({ transientAttachmentCount: 1 })).toBe(
      true,
    );
    expect(hasAttachmentNavigationRisk({ stagedRefs: [stagedRef] })).toBe(true);
    expect(
      hasAttachmentNavigationRisk({
        stagedRefs: [stagedRef],
        draftState: {
          batchId: "other-batch",
          refs: [stagedRef],
          updatedAt: "2026-06-28T00:00:00.000Z",
        },
      }),
    ).toBe(true);
  });

  it("blocks native unload only while the guard is active", () => {
    const { rerender } = render(<GuardHarness shouldWarn={false} />);

    expect(dispatchBeforeUnload()).toEqual({
      allowed: true,
      defaultPrevented: false,
    });

    rerender(<GuardHarness shouldWarn />);
    expect(dispatchBeforeUnload()).toEqual({
      allowed: false,
      defaultPrevented: true,
    });

    rerender(<GuardHarness shouldWarn={false} />);
    expect(dispatchBeforeUnload()).toEqual({
      allowed: true,
      defaultPrevented: false,
    });
  });
});
