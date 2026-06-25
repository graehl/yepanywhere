/**
 * JSONL file reading utilities.
 *
 * Shared helpers for reading JSONL session files with BOM handling
 * and partial reads (to avoid loading multi-MB files entirely).
 */

import { open, readFile } from "node:fs/promises";
import * as zlib from "node:zlib";
import { promisify } from "node:util";

/** Strip UTF-8 BOM if present (common on Windows). */
export function stripBom(str: string): string {
  return str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
}

type ZstdDecompress = (
  input: Buffer,
  callback: (error: Error | null, result: Buffer) => void,
) => void;

let zstdDecompressAsync:
  | ((input: Buffer) => Promise<Buffer>)
  | null
  | undefined;

function isZstdPath(filePath: string): boolean {
  return filePath.endsWith(".zst");
}

function getZstdDecompress(): ((input: Buffer) => Promise<Buffer>) | null {
  if (zstdDecompressAsync !== undefined) {
    return zstdDecompressAsync;
  }

  const candidate = (zlib as typeof zlib & { zstdDecompress?: ZstdDecompress })
    .zstdDecompress;
  zstdDecompressAsync =
    typeof candidate === "function" ? promisify(candidate) : null;
  return zstdDecompressAsync;
}

async function readUtf8File(filePath: string): Promise<string> {
  if (!isZstdPath(filePath)) {
    return readFile(filePath, "utf-8");
  }

  const decompress = getZstdDecompress();
  if (!decompress) {
    throw new Error("zstd-compressed JSONL is not supported by this Node.js");
  }

  const raw = await readFile(filePath);
  const decompressed = await decompress(raw);
  return decompressed.toString("utf-8");
}

/**
 * Read the first line of a file using a partial read.
 * Reads in chunks until it finds a newline, reaches EOF, or hits maxBytes.
 * Returns null for empty files or empty first lines.
 */
export async function readFirstLine(
  filePath: string,
  maxBytes = 4096,
): Promise<string | null> {
  if (isZstdPath(filePath)) {
    try {
      const content = stripBom(await readUtf8File(filePath));
      const nl = content.indexOf("\n");
      const line = (nl > 0 ? content.slice(0, nl) : content).trim();
      return line || null;
    } catch {
      return null;
    }
  }

  let fd: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fd = await open(filePath, "r");
    const chunkSize = Math.min(4096, maxBytes);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let content = "";

    while (totalBytes < maxBytes) {
      const remaining = maxBytes - totalBytes;
      const buf = Buffer.alloc(Math.min(chunkSize, remaining));
      const { bytesRead } = await fd.read(buf, 0, buf.length, totalBytes);
      if (bytesRead === 0) break;

      chunks.push(buf.subarray(0, bytesRead));
      totalBytes += bytesRead;
      content = Buffer.concat(chunks).toString("utf-8");
      if (content.includes("\n")) break;
    }

    if (totalBytes === 0) return null;

    const stripped = stripBom(content);
    const nl = stripped.indexOf("\n");
    const line = (nl > 0 ? stripped.slice(0, nl) : stripped).trim();
    return line || null;
  } catch {
    return null;
  } finally {
    await fd?.close();
  }
}

/**
 * Read a file and return BOM-stripped lines.
 */
export async function readJsonlLines(filePath: string): Promise<string[]> {
  const raw = await readUtf8File(filePath);
  return stripBom(raw).trim().split("\n");
}
