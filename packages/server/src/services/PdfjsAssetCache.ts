/**
 * pdf.js for the opt-in client PDF renderer, fetched on first demand rather
 * than shipped with YA. The npm tarball is pinned by version and by the
 * registry's published sha512 integrity, and nothing from it is written to
 * disk before that hash matches, so the served code is exactly the reviewed
 * release, as a lockfile dependency would be. Only the runtime assets the
 * client asks for are extracted: the display and worker modules and the
 * character maps, standard fonts, image decoders, and color profiles they
 * load by URL.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { PDFJS_VERSION } from "@yep-anywhere/shared";

const PDFJS_TARBALL_URL = `https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-${PDFJS_VERSION}.tgz`;
const PDFJS_TARBALL_INTEGRITY =
  "sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==";
/** The pinned tarball is 8.1 MB; anything far larger is not that release. */
const MAX_TARBALL_BYTES = 32 * 1024 * 1024;

const SERVED_FILE =
  /^(?:build\/pdf(?:\.worker)?\.min\.mjs|(?:cmaps|standard_fonts|wasm|iccs)\/[A-Za-z0-9_.-]+|LICENSE)$/;

const CONTENT_TYPES: Record<string, string> = {
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

/** Whether `path` names a runtime asset this cache extracts and serves. */
export function isServedPdfjsFile(path: string): boolean {
  return SERVED_FILE.test(path) && !path.split("/").includes("..");
}

export function pdfjsContentType(path: string): string {
  const extension = path.slice(path.lastIndexOf("."));
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/** Regular files of an uncompressed tar archive, honoring pax and ustar names. */
export function* readTarFiles(
  archive: Buffer,
): Generator<{ path: string; data: Buffer }> {
  let offset = 0;
  let paxPath: string | undefined;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return;
    const field = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1) || "0";
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const data = archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString("utf8"))?.[1];
      continue;
    }
    const path = paxPath ?? name;
    paxPath = undefined;
    if (type === "0") yield { path, data };
  }
}

export class PdfjsAssetCache {
  private readonly root: string;
  private installing: Promise<void> | null = null;

  constructor(
    dataDir: string,
    private readonly fetchTarball: () => Promise<Buffer> = downloadTarball,
    private readonly integrity = PDFJS_TARBALL_INTEGRITY,
  ) {
    this.root = join(dataDir, "pdfjs", PDFJS_VERSION);
  }

  /** Bytes of a served asset, downloading the release on first demand. */
  async read(path: string): Promise<Buffer> {
    if (!isServedPdfjsFile(path))
      throw new Error(`Not a pdf.js asset: ${path}`);
    await this.ensureInstalled();
    return await readFile(join(this.root, path));
  }

  private async ensureInstalled(): Promise<void> {
    if (await exists(join(this.root, ".complete"))) return;
    this.installing ??= this.install().finally(() => {
      this.installing = null;
    });
    await this.installing;
  }

  private async install(): Promise<void> {
    const tarball = await this.fetchTarball();
    const digest = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    if (digest !== this.integrity)
      throw new Error(
        `pdf.js ${PDFJS_VERSION} tarball integrity mismatch: got ${digest}`,
      );
    const staging = `${this.root}.partial-${process.pid}`;
    await rm(staging, { recursive: true, force: true });
    for (const entry of readTarFiles(gunzipSync(tarball))) {
      const path = entry.path.replace(/^package\//, "");
      if (!isServedPdfjsFile(path)) continue;
      const target = join(staging, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.data);
    }
    await writeFile(join(staging, ".complete"), `${digest}\n`);
    await rm(this.root, { recursive: true, force: true });
    await mkdir(dirname(this.root), { recursive: true });
    await rename(staging, this.root);
  }
}

async function downloadTarball(): Promise<Buffer> {
  const response = await fetch(PDFJS_TARBALL_URL);
  if (!response.ok)
    throw new Error(`pdf.js download failed: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_TARBALL_BYTES)
    throw new Error(`pdf.js download too large: ${declared} bytes`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_TARBALL_BYTES)
    throw new Error(`pdf.js download too large: ${bytes.length} bytes`);
  return bytes;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
