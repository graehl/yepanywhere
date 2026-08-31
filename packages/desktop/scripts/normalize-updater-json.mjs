import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const WINDOWS_CANONICAL_KEY = "windows-x86_64";
const WINDOWS_NSIS_KEY = "windows-x86_64-nsis";

function requirePlatform(platforms, key, extension) {
  const entry = platforms[key];
  if (!entry || typeof entry !== "object") {
    throw new Error(`missing ${key} updater entry`);
  }
  if (typeof entry.url !== "string" || !entry.url.endsWith(extension)) {
    throw new Error(`${key} updater URL must end with ${extension}`);
  }
  if (typeof entry.signature !== "string" || entry.signature.length <= 10) {
    throw new Error(`${key} updater signature is missing or too short`);
  }
  return entry;
}

export function normalizeDesktopUpdaterMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    throw new Error("updater metadata must be an object");
  }
  if (!metadata.platforms || typeof metadata.platforms !== "object") {
    throw new Error("updater metadata must contain a platforms object");
  }

  const platforms = metadata.platforms;
  const msiEntry = Object.entries(platforms).find(
    ([key, entry]) =>
      key.toLowerCase().includes("msi") ||
      (typeof entry?.url === "string" &&
        entry.url.toLowerCase().endsWith(".msi")),
  );
  if (msiEntry) {
    throw new Error(`MSI updater entries are unsupported: ${msiEntry[0]}`);
  }

  const nsis = requirePlatform(platforms, WINDOWS_NSIS_KEY, ".exe");
  platforms[WINDOWS_CANONICAL_KEY] = structuredClone(nsis);
  return metadata;
}

async function main(args) {
  if (args.length !== 1) {
    throw new Error("usage: normalize-updater-json.mjs <latest.json>");
  }

  const path = args[0];
  const metadata = JSON.parse(await readFile(path, "utf8"));
  normalizeDesktopUpdaterMetadata(metadata);
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
