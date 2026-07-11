#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const script = process.argv[2];

if (!script) {
  console.error("Usage: run-site-npm.mjs <script>");
  process.exit(1);
}

const env = { ...process.env };
delete env.npm_config_recursive;
delete env.NPM_CONFIG_RECURSIVE;

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmBin, ["run", script], {
  cwd: new URL("../site/", import.meta.url),
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
