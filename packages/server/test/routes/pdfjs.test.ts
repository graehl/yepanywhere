import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { PDFJS_VERSION } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPdfjsRoutes } from "../../src/routes/pdfjs.js";
import {
  PdfjsAssetCache,
  readTarFiles,
} from "../../src/services/PdfjsAssetCache.js";

function tarHeader(name: string, size: number, type: string, prefix = "") {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write(size.toString(8).padStart(11, "0"), 124, 12);
  header.write(type, 156, 1);
  header.write("ustar\0", 257, 6);
  header.write(prefix, 345, 155);
  return header;
}

function tarEntry(name: string, content: string, type = "0", prefix = "") {
  const data = Buffer.from(content);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return [tarHeader(name, data.length, type, prefix), data, padding];
}

function paxPath(longPath: string, content: string) {
  const record = (length: number) => `${length} path=${longPath}\n`;
  let length = record(0).length;
  while (record(length).length !== length) length = record(length).length;
  return [
    ...tarEntry("PaxHeader", record(length), "x"),
    ...tarEntry("truncated-name", content),
  ];
}

function tarball(): Buffer {
  return gzipSync(
    Buffer.concat([
      ...tarEntry("package/build/pdf.min.mjs", "export const display = 1;"),
      ...tarEntry(
        "pdf.worker.min.mjs",
        "export const worker = 1;",
        "0",
        "package/build",
      ),
      ...paxPath("package/cmaps/UniJIS-UCS2-H.bcmap", "cmap-bytes"),
      ...tarEntry("package/build/pdf.mjs", "unminified, not served"),
      ...tarEntry("package/README.md", "not served"),
      Buffer.alloc(1024),
    ]),
  );
}

const integrityOf = (bytes: Buffer) =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

describe("pdf.js asset routes", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "yep-pdfjs-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("reads pax and ustar-prefixed names from a tar archive", () => {
    const paths = [
      ...readTarFiles(
        Buffer.concat([
          ...tarEntry("b.txt", "b", "0", "package/a"),
          ...paxPath("package/long/name.txt", "c"),
          Buffer.alloc(1024),
        ]),
      ),
    ].map((entry) => `${entry.path}=${entry.data.toString()}`);
    expect(paths).toEqual(["package/a/b.txt=b", "package/long/name.txt=c"]);
  });

  it("downloads once on first demand and serves the pinned assets", async () => {
    const bytes = tarball();
    const fetchTarball = vi.fn(async () => bytes);
    const routes = createPdfjsRoutes(
      new PdfjsAssetCache(dataDir, fetchTarball, integrityOf(bytes)),
    );
    const base = `/pdfjs/${PDFJS_VERSION}`;

    const [display, worker] = await Promise.all([
      routes.request(`${base}/build/pdf.min.mjs`),
      routes.request(`${base}/build/pdf.worker.min.mjs`),
    ]);
    expect(display.status).toBe(200);
    expect(display.headers.get("content-type")).toContain("text/javascript");
    expect(await display.text()).toBe("export const display = 1;");
    expect(await worker.text()).toBe("export const worker = 1;");

    const cmap = await routes.request(`${base}/cmaps/UniJIS-UCS2-H.bcmap`);
    expect(await cmap.text()).toBe("cmap-bytes");
    expect(fetchTarball).toHaveBeenCalledTimes(1);

    expect((await routes.request(`${base}/build/pdf.mjs`)).status).toBe(404);
    expect((await routes.request(`${base}/README.md`)).status).toBe(404);
    expect((await routes.request(`${base}/cmaps/absent.bcmap`)).status).toBe(
      404,
    );
    expect(
      (await routes.request("/pdfjs/0.0.1/build/pdf.min.mjs")).status,
    ).toBe(404);
  });

  it("refuses a tarball whose hash is not the pinned one and writes nothing", async () => {
    const routes = createPdfjsRoutes(
      new PdfjsAssetCache(
        dataDir,
        async () => tarball(),
        integrityOf(Buffer.from("other")),
      ),
    );
    const response = await routes.request(
      `/pdfjs/${PDFJS_VERSION}/build/pdf.min.mjs`,
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("integrity mismatch");
    expect(await readdir(dataDir)).toEqual([]);
  });
});
