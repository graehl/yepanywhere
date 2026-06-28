import type { StagedAttachmentRef, UploadedFile } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../connection/types";
import {
  deleteDraftAttachmentRef,
  materializeDraftAttachmentsForSession,
  validateDraftAttachmentRefs,
} from "../draftAttachmentStaging";
import type { DraftAttachmentState } from "../draftEnvelope";

const stagedRef: StagedAttachmentRef = {
  id: "file-a",
  batchId: "batch-a",
  originalName: "screenshot.png",
  name: "uuid_screenshot.png",
  size: 123,
  mimeType: "image/png",
  width: 800,
  height: 600,
  createdAt: "2026-06-28T00:00:00.000Z",
  updatedAt: "2026-06-28T00:00:00.000Z",
};

const state: DraftAttachmentState = {
  batchId: "batch-a",
  refs: [stagedRef],
  updatedAt: "2026-06-28T00:00:00.000Z",
};

function createConnection(response: unknown): Connection {
  return {
    fetch: vi.fn().mockResolvedValue(response),
  } as unknown as Connection;
}

describe("draftAttachmentStaging", () => {
  it("validates draft refs against the staging batch", async () => {
    const connection = createConnection({ refs: [stagedRef] });

    await expect(
      validateDraftAttachmentRefs(connection, state),
    ).resolves.toEqual([stagedRef]);

    expect(connection.fetch).toHaveBeenCalledWith(
      "/attachments/staging/drafts/batch-a/validate",
      {
        method: "POST",
        body: JSON.stringify({ refs: [stagedRef] }),
      },
    );
  });

  it("deletes a staged draft ref with encoded path segments", async () => {
    const connection = createConnection({ deleted: true });

    await expect(
      deleteDraftAttachmentRef(connection, "batch/a", "file b"),
    ).resolves.toBe(true);

    expect(connection.fetch).toHaveBeenCalledWith(
      "/attachments/staging/drafts/batch%2Fa/file%20b",
      { method: "DELETE" },
    );
  });

  it("materializes staged refs for a session", async () => {
    const uploadedFile: UploadedFile = {
      id: "file-a",
      originalName: "screenshot.png",
      name: "uuid_screenshot.png",
      path: "/projects/example/.attachments/session-a/uuid_screenshot.png",
      size: 123,
      mimeType: "image/png",
      width: 800,
      height: 600,
    };
    const connection = createConnection({ files: [uploadedFile] });

    await expect(
      materializeDraftAttachmentsForSession(
        connection,
        "project-a",
        "session/a",
        state,
      ),
    ).resolves.toEqual([uploadedFile]);

    expect(connection.fetch).toHaveBeenCalledWith(
      "/projects/project-a/sessions/session%2Fa/attachments/staging/materialize",
      {
        method: "POST",
        body: JSON.stringify({
          batchId: "batch-a",
          refs: [stagedRef],
        }),
      },
    );
  });
});
