const RESIZABLE_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const SD_JPEG_QUALITY = 0.9;

function getOutputMimeType(mimeType: string): string {
  if (!RESIZABLE_IMAGE_MIME_TYPES.has(mimeType)) {
    return "image/jpeg";
  }
  switch (mimeType) {
    case "image/jpg":
      return "image/jpeg";
    case "image/gif":
      return "image/png";
    default:
      return mimeType;
  }
}

async function blobFromCanvas(
  canvas: HTMLCanvasElement,
  mimeType: string,
): Promise<Blob | null> {
  return await new Promise<Blob | null>((resolve) => {
    const quality = mimeType === "image/png" ? undefined : SD_JPEG_QUALITY;
    canvas.toBlob(
      (blob) => resolve(blob),
      mimeType,
      quality,
    );
  });
}

export async function resizeImageFile(
  file: File,
  maxLongEdgePx: number,
): Promise<File> {
  if (typeof createImageBitmap !== "function") {
    return file;
  }
  if (!file.type.startsWith("image/")) {
    return file;
  }
  if (!RESIZABLE_IMAGE_MIME_TYPES.has(file.type)) {
    return file;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (!Number.isFinite(longEdge) || longEdge <= maxLongEdgePx) {
      return file;
    }

    const scale = maxLongEdgePx / longEdge;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return file;
    }
    // Use the browser's native canvas scaler for the downsample.
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await blobFromCanvas(canvas, getOutputMimeType(file.type));
    if (!blob) {
      return file;
    }

    return new File([blob], file.name, {
      type: blob.type || getOutputMimeType(file.type),
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
