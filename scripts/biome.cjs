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

const { spawnSync } = require('child_process');

const env = { ...process.env };

if (process.platform === 'linux' && !env.BIOME_BINARY) {
  // Force the static musl build that has no glibc dependency.
  // The package is already an optionalDependency of @biomejs/biome.
  env.BIOME_BINARY = '@biomejs/cli-linux-x64-musl/biome';
}

const result = spawnSync('pnpm', ['exec', 'biome', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  shell: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
