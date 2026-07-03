#!/usr/bin/env node

// Runtime console volume report over ClientLogCollector jsonl files
// ({dataDir}/logs/client-logs/client-YYYY-MM-DD-{deviceId}.jsonl). This is
// the "is the client overly chatty outside dev mode" measurement on real
// devices; the static companion is find-console-chatter.mjs.

import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(`Usage: node scripts/report-client-log-volume.mjs [logsDir]

Summarizes per-device client console volume: lines by level, top prefixes,
and peak lines/minute. Default logsDir: ~/.yep-anywhere/logs/client-logs
(honors YEP_DATA_DIR). Requires the Developer Mode "Remote Log Collection"
toggle to have been enabled on the device.
`);
  process.exit(0);
}

const dataDir =
  process.env.YEP_DATA_DIR ?? path.join(os.homedir(), ".yep-anywhere");
const logsDir = args[0] ?? path.join(dataDir, "logs", "client-logs");

let entries;
try {
  entries = (await readdir(logsDir)).filter((name) => name.endsWith(".jsonl"));
} catch {
  console.error(`No client log directory at ${logsDir}`);
  console.error(
    "Enable Developer Mode -> Remote Log Collection on a device first.",
  );
  process.exit(1);
}
if (entries.length === 0) {
  console.log(`No client log files in ${logsDir}`);
  process.exit(0);
}

for (const name of entries.sort()) {
  const filePath = path.join(logsDir, name);
  const byLevel = {};
  const byPrefix = {};
  const byMinute = new Map();
  let total = 0;
  let firstTs = Number.POSITIVE_INFINITY;
  let lastTs = 0;
  const text = await readFile(filePath, "utf8");
  for (const line of text.split("\n")) {
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    total += 1;
    byLevel[event.level ?? "?"] = (byLevel[event.level ?? "?"] ?? 0) + 1;
    const prefix = event.prefix ?? "(none)";
    byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
    if (typeof event.timestamp === "number") {
      firstTs = Math.min(firstTs, event.timestamp);
      lastTs = Math.max(lastTs, event.timestamp);
      const minute = Math.floor(event.timestamp / 60_000);
      byMinute.set(minute, (byMinute.get(minute) ?? 0) + 1);
    }
  }
  if (total === 0) continue;

  const spanMinutes = Math.max(1, (lastTs - firstTs) / 60_000);
  const peak = [...byMinute.entries()].sort((a, b) => b[1] - a[1])[0];
  const topPrefixes = Object.entries(byPrefix)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([prefix, count]) => `    ${count}\t${prefix}`)
    .join("\n");

  console.log(`${name}`);
  console.log(
    `  ${total} lines over ${spanMinutes.toFixed(0)} min (avg ${(total / spanMinutes).toFixed(1)}/min, peak ${peak ? `${peak[1]}/min at ${new Date(peak[0] * 60_000).toISOString()}` : "n/a"})`,
  );
  console.log(
    `  levels: ${Object.entries(byLevel)
      .map(([level, count]) => `${level}=${count}`)
      .join(" ")}`,
  );
  console.log(`  top prefixes:\n${topPrefixes}`);
}
