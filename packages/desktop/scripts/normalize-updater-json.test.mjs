import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDesktopUpdaterMetadata } from "./normalize-updater-json.mjs";

const signature = "signed-updater-payload";

function updaterEntry(url) {
  return { signature, url };
}

test("the canonical Windows updater follows the primary NSIS installer", () => {
  const metadata = {
    version: "0.2.0",
    platforms: {
      "darwin-aarch64": updaterEntry("https://example.test/app.tar.gz"),
      "windows-x86_64": updaterEntry("https://example.test/old-setup.exe"),
      "windows-x86_64-nsis": updaterEntry("https://example.test/setup.exe"),
    },
  };

  normalizeDesktopUpdaterMetadata(metadata);

  assert.deepEqual(
    metadata.platforms["windows-x86_64"],
    metadata.platforms["windows-x86_64-nsis"],
  );
  assert.equal(
    metadata.platforms["darwin-aarch64"].url,
    "https://example.test/app.tar.gz",
  );
});

test("normalization rejects MSI updater metadata", () => {
  assert.throws(
    () =>
      normalizeDesktopUpdaterMetadata({
        platforms: {
          "windows-x86_64": updaterEntry("https://example.test/setup.exe"),
          "windows-x86_64-msi": updaterEntry("https://example.test/app.msi"),
          "windows-x86_64-nsis": updaterEntry(
            "https://example.test/setup.exe",
          ),
        },
      }),
    /MSI updater entries are unsupported/,
  );
});

test("normalization rejects an MSI URL under a generic platform key", () => {
  assert.throws(
    () =>
      normalizeDesktopUpdaterMetadata({
        platforms: {
          "windows-x86_64": updaterEntry("https://example.test/app.msi"),
          "windows-x86_64-nsis": updaterEntry(
            "https://example.test/setup.exe",
          ),
        },
      }),
    /MSI updater entries are unsupported/,
  );
});

test("normalization rejects metadata without a signed NSIS updater", () => {
  assert.throws(
    () =>
      normalizeDesktopUpdaterMetadata({
        platforms: {
          "windows-x86_64": updaterEntry("https://example.test/setup.exe"),
        },
      }),
    /missing windows-x86_64-nsis updater entry/,
  );
});
