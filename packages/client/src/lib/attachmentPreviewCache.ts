import type { UploadedFile } from "@yep-anywhere/shared";
import {
  deleteEntry,
  getEntry,
  openDatabase,
  putEntryWithKey,
} from "./diagnostics/idb";

const DB_NAME = "yep-anywhere-attachment-previews";
const DB_VERSION = 1;
const STORE_NAME = "images";
const MAX_THUMB_LONG_EDGE_PX = 96;

interface CachedAttachmentPreview {
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
  thumbnailBlob?: Blob;
  fullBlob: Blob;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function getDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase(DB_NAME, DB_VERSION, (db) => {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    });
  }
  return dbPromise;
}

async function createThumbnailBlob(file: Blob): Promise<Blob | undefined> {
  if (typeof createImageBitmap !== "function") {
    return undefined;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= MAX_THUMB_LONG_EDGE_PX) {
      return file.slice(0, file.size, file.type);
    }

    const scale = MAX_THUMB_LONG_EDGE_PX / longEdge;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return undefined;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return await new Promise<Blob | undefined>((resolve) => {
      canvas.toBlob((blob) => resolve(blob ?? undefined), file.type || "image/png");
    });
  } catch {
    return undefined;
  }
}

export async function storeUploadedAttachmentPreview(
  uploadedFile: UploadedFile,
  sourceFile: File,
): Promise<void> {
  if (!isImageMimeType(uploadedFile.mimeType)) {
    return;
  }

  const fullBlob = sourceFile.slice(0, sourceFile.size, sourceFile.type);
  const thumbnailBlob = await createThumbnailBlob(sourceFile);

  const db = await getDatabase();
  await putEntryWithKey<CachedAttachmentPreview>(db, STORE_NAME, uploadedFile.path, {
    path: uploadedFile.path,
    originalName: uploadedFile.originalName,
    mimeType: uploadedFile.mimeType,
    size: uploadedFile.size,
    thumbnailBlob,
    fullBlob,
    createdAt: Date.now(),
  });
}

export async function loadCachedAttachmentPreview(
  path: string,
): Promise<CachedAttachmentPreview | null> {
  const db = await getDatabase();
  return getEntry<CachedAttachmentPreview>(db, STORE_NAME, path);
}

export async function deleteCachedAttachmentPreview(path: string): Promise<void> {
  const db = await getDatabase();
  await deleteEntry(db, STORE_NAME, path);
}

export function isCacheableAttachmentMimeType(mimeType: string): boolean {
  return isImageMimeType(mimeType);
}

