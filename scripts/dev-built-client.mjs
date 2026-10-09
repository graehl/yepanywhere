import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";

/** Prepare a complete client build without changing the running server's files. */
export async function prepareBuiltClient(rootDir, build, previous) {
  const cache = join(rootDir, "node_modules", ".cache", "ya-client");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "build-"));
  try {
    await build(directory);
    await readFile(join(directory, "index.html"));
    const assets = await readdir(join(directory, "assets"));
    // Keep one previous generation's lazy chunks available after a reload.
    // Only its original assets carry forward, so retention stays bounded.
    for (const name of previous?.assets ?? []) {
      if (!assets.includes(name)) {
        await copyFile(
          join(previous.directory, "assets", name),
          join(directory, "assets", name),
          constants.COPYFILE_EXCL,
        );
      }
    }
    return { directory, assets };
  } catch (error) {
    await rm(directory, { recursive: true });
    throw error;
  }
}
