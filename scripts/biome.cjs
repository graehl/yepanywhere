#!/usr/bin/env node
/**
 * Small launcher for Biome that forces the statically-linked musl binary on Linux.
 *
 * This makes `pnpm lint` / `pnpm format` work on older glibc distros (Rocky 8, RHEL 8,
 * certain containers, NixOS, etc.) while remaining a no-op on macOS/Windows and on
 * modern glibc Linux (where either binary would work).
 *
 * The musl binary is fully static and is what Biome itself recommends for maximum
 * host compatibility. We keep this thin wrapper instead of setting BIOME_BINARY in
 * package.json scripts directly for cross-platform cleanliness and future flexibility
 * (e.g. allowing a BIOME_HOST_BINARY escape hatch for local source builds).
 */

const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

const env = { ...process.env };
const MAX_WINDOWS_COMMAND_CHARS = 24_000;

if (process.platform === "linux" && !env.BIOME_BINARY) {
  // Force the static musl build that has no glibc dependency.
  // The package is already an optionalDependency of @biomejs/biome.
  env.BIOME_BINARY =
    process.arch === "arm64"
      ? "@biomejs/cli-linux-arm64-musl/biome"
      : "@biomejs/cli-linux-x64-musl/biome";
}

const biomeBin = resolveBiomeBin();
const biomeArgSets = expandDotTargetsToTrackedFiles(process.argv.slice(2));

let exitStatus = 0;

for (const biomeArgs of biomeArgSets) {
  const result = spawnSync(process.execPath, [biomeBin, ...biomeArgs], {
    stdio: "inherit",
    env,
    shell: false,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`Biome terminated by signal ${result.signal}`);
    process.exit(1);
  }
  if (result.status && result.status !== 0) {
    exitStatus = result.status;
  }
}

process.exit(exitStatus);

function resolveBiomeBin() {
  try {
    return require.resolve("@biomejs/biome/bin/biome");
  } catch (error) {
    console.error("Could not resolve local @biomejs/biome binary.");
    console.error(error);
    process.exit(1);
  }
}

function expandDotTargetsToTrackedFiles(args) {
  if (!usesTrackedFileExpansion(args)) return [args];

  const trackedFiles = getTrackedFiles();
  if (trackedFiles.length === 0) return [args];

  if (process.platform !== "win32") {
    return [args.flatMap((arg) => (arg === "." ? trackedFiles : [arg]))];
  }

  return chunkExpandedDotTargets(args, trackedFiles);
}

function usesTrackedFileExpansion(args) {
  if (!["check", "ci", "format", "lint"].includes(args[0])) return false;
  if (args.includes("--help") || args.includes("-h")) return false;
  return args.includes(".");
}

function chunkExpandedDotTargets(args, trackedFiles) {
  const dotCount = args.filter((arg) => arg === ".").length;
  const baseArgs = args.filter((arg) => arg !== ".");
  const baseLength = estimateCommandLength([
    process.execPath,
    biomeBin,
    ...baseArgs,
  ]);
  const maxChunkLength = Math.max(
    1_000,
    MAX_WINDOWS_COMMAND_CHARS - baseLength,
  );
  const chunks = [];
  let current = [];
  let currentLength = 0;

  for (const file of trackedFiles) {
    const fileLength = estimateCommandLength([file]) * dotCount;
    if (current.length > 0 && currentLength + fileLength > maxChunkLength) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(file);
    currentLength += fileLength;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks.map((chunk) =>
    args.flatMap((arg) => (arg === "." ? chunk : [arg])),
  );
}

function estimateCommandLength(args) {
  return args.reduce((length, arg) => length + arg.length + 3, 0);
}

function getTrackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    encoding: "buffer",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter((file) => file.length > 0 && existsSync(file));
}
