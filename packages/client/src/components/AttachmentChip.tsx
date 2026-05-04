import { useEffect, useMemo, useRef, useState } from "react";
import { useRemoteImage } from "../hooks/useRemoteImage";
import { loadCachedAttachmentPreview } from "../lib/attachmentPreviewCache";
import { Modal } from "./ui/Modal";

export interface AttachmentChipProps {
  originalName: string;
  path: string;
  mimeType: string;
  sizeLabel: string;
  previewUrl?: string;
  onRemove?: () => void;
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function getUploadUrl(filePath: string): string | null {
  const parts = filePath.split("/");
  if (parts.length < 3) return null;

  const filename = parts[parts.length - 1];
  const sessionId = parts[parts.length - 2];
  const projectId = parts[parts.length - 3];

  if (!filename || !sessionId || !projectId) return null;
  if (!/^[0-9a-f-]{36}_/.test(filename)) return null;

  return `/api/projects/${projectId}/sessions/${sessionId}/upload/${encodeURIComponent(filename)}`;
}

function useCachedAttachmentImage(
  path: string,
  previewUrl?: string,
): {
  previewUrl: string | null;
  fullUrl: string | null;
  loading: boolean;
  error: string | null;
} {
  const [cachePreviewUrl, setCachePreviewUrl] = useState<string | null>(null);
  const [cacheFullUrl, setCacheFullUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const previewUrlRef = useRef<string | null>(null);
  const fullUrlRef = useRef<string | null>(null);

  const remotePath = useMemo(() => getUploadUrl(path), [path]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setCachePreviewUrl(null);
    setCacheFullUrl(null);

    if (previewUrl) {
      setLoading(false);
      setRemoteEnabled(false);
      return () => {
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
        }
        if (fullUrlRef.current) {
          URL.revokeObjectURL(fullUrlRef.current);
          fullUrlRef.current = null;
        }
      };
    }

    setLoading(true);
    setRemoteEnabled(false);
    loadCachedAttachmentPreview(path)
      .then((entry) => {
        if (cancelled) return;
        if (!entry) {
          setLoading(false);
          setRemoteEnabled(true);
          return;
        }

        const thumbBlob = entry.thumbnailBlob ?? entry.fullBlob;
        const previewObjectUrl = URL.createObjectURL(thumbBlob);
        const fullObjectUrl = URL.createObjectURL(entry.fullBlob);
        previewUrlRef.current = previewObjectUrl;
        fullUrlRef.current = fullObjectUrl;
        setCachePreviewUrl(previewObjectUrl);
        setCacheFullUrl(fullObjectUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load attachment preview");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      if (fullUrlRef.current) {
        URL.revokeObjectURL(fullUrlRef.current);
        fullUrlRef.current = null;
      }
    };
  }, [path, previewUrl]);

  const remote = useRemoteImage(remotePath, remoteEnabled && !previewUrl);

  return {
      previewUrl: previewUrl ?? cachePreviewUrl ?? remote.url,
      fullUrl: previewUrl ?? cacheFullUrl ?? remote.url,
      loading: loading || remote.loading,
      error: error ?? remote.error,
  };
}

export function AttachmentChip({
  originalName,
  path,
  mimeType,
  sizeLabel,
  previewUrl,
  onRemove,
}: AttachmentChipProps) {
  const [showModal, setShowModal] = useState(false);
  const isImage = isImageMimeType(mimeType);
  const { previewUrl: imagePreviewUrl, fullUrl, loading, error } =
    useCachedAttachmentImage(path, previewUrl);

  if (!isImage) {
    return (
      <span className="attachment-chip" title={`${mimeType}, ${sizeLabel}`}>
        <span className="attachment-chip-icon" aria-hidden="true">
          📎
        </span>
        <span className="attachment-name" title={path}>
          {originalName}
        </span>
        <span className="attachment-size">{sizeLabel}</span>
        {onRemove && (
          <button
            type="button"
            className="attachment-remove"
            onClick={onRemove}
            aria-label={`Remove ${originalName}`}
          >
            x
          </button>
        )}
      </span>
    );
  }

  return (
    <>
      <div className="attachment-chip attachment-chip-image" title={`${mimeType}, ${sizeLabel}`}>
        <button
          type="button"
          className="attachment-chip-main"
          onClick={() => setShowModal(true)}
          aria-label={`Open ${originalName}`}
          title={`${mimeType}, ${sizeLabel}`}
        >
          <span className="attachment-preview" aria-hidden="true">
            {imagePreviewUrl ? (
              <img src={imagePreviewUrl} alt="" />
            ) : (
              <span className="attachment-preview-fallback">📎</span>
            )}
          </span>
          <span className="attachment-name" title={path}>
            {originalName}
          </span>
          <span className="attachment-size">{sizeLabel}</span>
        </button>
        {onRemove && (
          <button
            type="button"
            className="attachment-remove"
            onClick={onRemove}
            aria-label={`Remove ${originalName}`}
          >
            x
          </button>
        )}
      </div>
      {showModal && (
        <Modal title={originalName} onClose={() => setShowModal(false)}>
          <div className="uploaded-image-modal">
            {loading && <div className="image-loading">Loading...</div>}
            {error && <div className="image-error">Failed to load image</div>}
            {fullUrl && <img src={fullUrl} alt={originalName} />}
          </div>
        </Modal>
      )}
    </>
  );
}
