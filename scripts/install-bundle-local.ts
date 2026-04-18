#!/usr/bin/env tsx

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const STAGING_DIR = path.join(ROOT_DIR, "dist/npm-package");

function run(command: string, cwd = ROOT_DIR): string {
  return execSync(command, {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  }).trim();
}

function runInherit(command: string, cwd = ROOT_DIR): void {
  execSync(command, {
    cwd,
    stdio: "inherit",
  });
}

console.log("[install-bundle-local] Building npm bundle...");
runInherit("pnpm build:bundle");

const cliPath = path.join(STAGING_DIR, "dist/cli.js");
if (fs.existsSync(cliPath)) {
  fs.chmodSync(cliPath, 0o755);
}

console.log("[install-bundle-local] Packing staged bundle...");
const tarballName = run("npm pack --silent", STAGING_DIR)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .at(-1);

if (!tarballName) {
  throw new Error("npm pack did not report a tarball name");
}

const tarballPath = path.join(STAGING_DIR, tarballName);
const globalPrefix = run("npm prefix -g");
const globalPackageDir = path.join(globalPrefix, "lib/node_modules/yepanywhere");
const globalBinPath = path.join(globalPrefix, "bin/yepanywhere");

console.log("[install-bundle-local] Removing previous global install...");
fs.rmSync(globalPackageDir, { recursive: true, force: true });
fs.rmSync(globalBinPath, { force: true });

console.log(`[install-bundle-local] Installing ${tarballName} globally...`);
runInherit(`npm install -g --force "${tarballPath}"`, STAGING_DIR);

console.log(`[install-bundle-local] Installed yepanywhere via ${tarballName}`);
