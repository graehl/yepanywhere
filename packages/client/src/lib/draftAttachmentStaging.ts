import type { StagedAttachmentRef, UploadedFile } from "@yep-anywhere/shared";
import type { DraftAttachmentState } from "./draftEnvelope";
import type { Connection } from "./connection/types";

interface DraftAttachmentRefsResponse {
  refs: StagedAttachmentRef[];
}

interface DeleteDraftAttachmentResponse {
  deleted: boolean;
}

interface MaterializeDraftAttachmentsResponse {
  files: UploadedFile[];
}

function draftAttachmentBody(refs: readonly StagedAttachmentRef[]): string {
  return JSON.stringify({ refs });
}

export async function validateDraftAttachmentRefs(
  connection: Connection,
  state: DraftAttachmentState,
): Promise<StagedAttachmentRef[]> {
  const response = await connection.fetch<DraftAttachmentRefsResponse>(
    `/attachments/staging/drafts/${encodeURIComponent(state.batchId)}/validate`,
    {
      method: "POST",
      body: draftAttachmentBody(state.refs),
    },
  );
  return response.refs;
}

export async function deleteDraftAttachmentRef(
  connection: Connection,
  batchId: string,
  attachmentId: string,
): Promise<boolean> {
  const response = await connection.fetch<DeleteDraftAttachmentResponse>(
    `/attachments/staging/drafts/${encodeURIComponent(batchId)}/${encodeURIComponent(
      attachmentId,
    )}`,
    { method: "DELETE" },
  );
  return response.deleted;
}

export async function materializeDraftAttachmentsForSession(
  connection: Connection,
  projectId: string,
  sessionId: string,
  state: DraftAttachmentState,
): Promise<UploadedFile[]> {
  const response = await connection.fetch<MaterializeDraftAttachmentsResponse>(
    `/projects/${projectId}/sessions/${encodeURIComponent(
      sessionId,
    )}/attachments/staging/materialize`,
    {
      method: "POST",
      body: JSON.stringify({
        batchId: state.batchId,
        refs: state.refs,
      }),
    },
  );
  return response.files;
}
