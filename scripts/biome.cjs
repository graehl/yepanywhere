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

if (process.platform === "linux" && !env.BIOME_BINARY) {
  // Force the static musl build that has no glibc dependency.
  // The package is already an optionalDependency of @biomejs/biome.
  env.BIOME_BINARY = "@biomejs/cli-linux-x64-musl/biome";
}

const biomeArgs = expandDotTargetsToTrackedFiles(process.argv.slice(2));

const result = spawnSync("pnpm", ["exec", "biome", ...biomeArgs], {
  stdio: "inherit",
  env,
  shell: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);

function expandDotTargetsToTrackedFiles(args) {
  if (!usesTrackedFileExpansion(args)) return args;

  const trackedFiles = getTrackedFiles();
  if (trackedFiles.length === 0) return args;

  return args.flatMap((arg) => (arg === "." ? trackedFiles : [arg]));
}

function usesTrackedFileExpansion(args) {
  if (!["check", "ci", "format", "lint"].includes(args[0])) return false;
  if (args.includes("--help") || args.includes("-h")) return false;
  return args.includes(".");
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
