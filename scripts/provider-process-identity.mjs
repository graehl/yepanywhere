import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// macOS ships this interpreter and Foundation on both arm64 and x64. The
// Objective-C bridge calls libproc directly: no compiler, Python, native addon,
// or human-readable/second-resolution ps timestamp is involved. Keep this
// literal here so it participates in the host's transitive source fingerprint.
const DARWIN_IDENTITY_SCRIPT = `
ObjC.import("Foundation");
ObjC.bindFunction("proc_pidinfo", ["int", ["int", "int", "uint64_t", "void *", "int"]]);
function run(argv) {
  var data = $.NSMutableData.dataWithLength(136);
  var size = $.proc_pidinfo(Number(argv[0]), 3, 1, data.mutableBytes, 136);
  return JSON.stringify({size: size, data: ObjC.unwrap(data.base64EncodedStringWithOptions(0))});
}`;

export function readLinuxProcessStartTime(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const startTime =
      commandEnd < 0
        ? undefined
        : stat
            .slice(commandEnd + 1)
            .trim()
            .split(/\s+/)[19];
    if (!startTime || !/^\d+$/.test(startTime)) {
      throw new Error(`Ambiguous process ${pid} start identity`);
    }
    return startTime;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ESRCH") return null;
    throw error;
  }
}

export function readProcessStartTime(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid process id");
  if (process.platform === "linux") return readLinuxProcessStartTime(pid);
  if (process.platform !== "darwin" || process.versions.bun) {
    throw new Error("Provider process identity is unsupported on this runtime");
  }
  const result = JSON.parse(
    execFileSync(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", DARWIN_IDENTITY_SCRIPT, String(pid)],
      {
        encoding: "utf8",
        timeout: 1_000,
        maxBuffer: 4096,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  if (result.size === 0) {
    // A failed libproc read is NOT absence. Confirm ESRCH separately; access
    // denial, bridge failure, and races with PID reuse must fail closed.
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return null;
      throw error;
    }
    throw new Error(`Inaccessible process ${pid} start identity`);
  }
  const data = Buffer.from(result.data, "base64");
  // Public proc_bsdinfo ABI (sys/proc_info.h): fixed-width fields on both
  // supported Mac architectures. Validate the complete record before use.
  if (
    result.size !== 136 ||
    data.length !== 136 ||
    data.readUInt32LE(12) !== pid
  ) {
    throw new Error(`Ambiguous process ${pid} start identity`);
  }
  const seconds = data.readBigUInt64LE(120);
  const micros = data.readBigUInt64LE(128);
  if (seconds === 0n || micros >= 1_000_000n)
    throw new Error(`Ambiguous process ${pid} start identity`);
  return `darwin:${seconds}:${micros}`;
}

export function captureProcessIdentity(pid = process.pid) {
  const startTime = readProcessStartTime(pid);
  if (!startTime)
    throw new Error(`Cannot capture process ${pid} start identity`);
  return { pid, startTime };
}

export function processIdentityState(target) {
  const current = readProcessStartTime(target.pid);
  return current === null
    ? "absent"
    : current === target.startTime
      ? "same"
      : "different";
}

export function processGroupAlive(processGroupId) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 1)
    throw new Error("Invalid process group id");
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

export function processGroupIdentityState(target) {
  if (!processGroupAlive(target.processGroupId)) return "absent";
  if (!target.leaderStartTime)
    throw new Error("Ambiguous process group identity");
  const current = readProcessStartTime(target.processGroupId);
  // A Unix process-group id remains reserved while its original descendants
  // belong to it, even after the leader exits. Only proven absence permits this.
  return current === null || current === target.leaderStartTime
    ? "same"
    : "different";
}

export function isOwnedProcessGroupAlive(target) {
  const state = processGroupIdentityState(target);
  if (state === "different")
    throw new Error(
      `Process group ${target.processGroupId} identity is ambiguous`,
    );
  return state === "same";
}

export function providerHostCapability({
  platform = process.platform,
  bun = Boolean(process.versions.bun),
  probe = true,
} = {}) {
  if (platform !== "linux" && platform !== "darwin")
    return { supported: false, reason: "unsupported-platform" };
  if (platform === "darwin" && bun)
    return {
      supported: false,
      reason: "macOS Bun provider hosting is not verified",
    };
  if (probe) {
    try {
      captureProcessIdentity();
    } catch (error) {
      return {
        supported: false,
        reason: `Process identity probe failed: ${error.message}`,
      };
    }
  }
  return { supported: true };
}

export function assertProviderSocketPath(path, platform = process.platform) {
  const limit = platform === "darwin" ? 103 : 107;
  if (Buffer.byteLength(path) > limit)
    throw new Error(
      `Provider host socket path exceeds ${limit} bytes; set YEP_PROVIDER_HOST_RUNTIME_DIR to a shorter private directory: ${path}`,
    );
}
