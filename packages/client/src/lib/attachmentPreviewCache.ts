import type { UploadedFile } from "@yep-anywhere/shared";
import {
  deleteEntry,
  getEntry,
  openDatabase,
  putEntryWithKey,
} from "./diagnostics/idb";

const DB_NAME = "yep-anywhere-attachment-previews";
const DB_VERSION = 2;
const STORE_NAME = "images";
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_THUMB_LONG_EDGE_PX = 96;

interface CachedAttachmentPreview {
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
  thumbnailBlob?: Blob;
  fullBlob: Blob;
  totalBytes: number;
  createdAt: number;
  lastAccessedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function getDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase(DB_NAME, DB_VERSION, (db, tx) => {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME);
        store.createIndex("byLastAccessedAt", "lastAccessedAt");
      } else {
        const store = tx.objectStore(
          STORE_NAME,
        );
        if (!store.indexNames.contains("byLastAccessedAt")) {
          store.createIndex("byLastAccessedAt", "lastAccessedAt");
        }
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

async function calculateCacheSize(db: IDBDatabase): Promise<number> {
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const request = store.getAll();
  const entries = (await new Promise<CachedAttachmentPreview[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as CachedAttachmentPreview[]);
    request.onerror = () => reject(request.error);
  })) ?? [];
  return entries.reduce((sum, entry) => sum + (entry.totalBytes ?? 0), 0);
}

async function evictOldestEntries(
  db: IDBDatabase,
  bytesToFree: number,
): Promise<void> {
  if (bytesToFree <= 0) return;

  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const index = store.index("byLastAccessedAt");
  let freed = 0;

  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || freed >= bytesToFree) {
        resolve();
        return;
      }

      const value = cursor.value as CachedAttachmentPreview;
      freed += value.totalBytes ?? 0;
      cursor.delete();
      cursor.continue();
    };
  });

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
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
  const totalBytes = fullBlob.size + (thumbnailBlob?.size ?? 0);

  const db = await getDatabase();
  await putEntryWithKey<CachedAttachmentPreview>(db, STORE_NAME, uploadedFile.path, {
    path: uploadedFile.path,
    originalName: uploadedFile.originalName,
    mimeType: uploadedFile.mimeType,
    size: uploadedFile.size,
    thumbnailBlob,
    fullBlob,
    totalBytes,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  });

  const cacheSize = await calculateCacheSize(db);
  if (cacheSize > MAX_CACHE_BYTES) {
    await evictOldestEntries(db, cacheSize - MAX_CACHE_BYTES);
  }
}

export async function loadCachedAttachmentPreview(
  path: string,
): Promise<CachedAttachmentPreview | null> {
  const db = await getDatabase();
  const entry = await getEntry<CachedAttachmentPreview>(db, STORE_NAME, path);
  if (!entry) return null;

  const updated = {
    ...entry,
    lastAccessedAt: Date.now(),
  };
  await putEntryWithKey<CachedAttachmentPreview>(db, STORE_NAME, path, updated);
  return updated;
}

export async function deleteCachedAttachmentPreview(path: string): Promise<void> {
  const db = await getDatabase();
  await deleteEntry(db, STORE_NAME, path);
}

export function isCacheableAttachmentMimeType(mimeType: string): boolean {
  return isImageMimeType(mimeType);
}
