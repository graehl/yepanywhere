import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Windows builds emit only the non-elevated NSIS installer", async () => {
  const configUrl = new URL(
    "../src-tauri/tauri.windows.conf.json",
    import.meta.url,
  );
  const config = JSON.parse(await readFile(configUrl, "utf8"));

  assert.deepEqual(config.bundle?.targets, ["nsis"]);
});
