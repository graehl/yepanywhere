import { execFile } from "node:child_process";
import { statfsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export const PIXI_COMMAND = "pixi";
export const PIXI_STT_ENV = "stt";
export const PIXI_PYTHON_ARGS = [
  "run",
  "--frozen",
  "-e",
  PIXI_STT_ENV,
  "python",
];
const LOCAL_STT_BOOTSTRAP_TIMEOUT_MS = 20 * 60_000;

export function localSttReadyHint(task: string): string {
  return `Run \`pixi run -e ${PIXI_STT_ENV} ${task}\` from the YA checkout, then restart YA.`;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function defaultHuggingFaceHubCache(): string {
  // Mirror Hugging Face's own hub-cache resolution so this reported path
  // matches where the spawned worker actually caches weights. HF consults
  // HF_HUB_CACHE, then HF_HOME/hub, then ~/.cache/huggingface/hub — it does
  // not use XDG_CACHE_HOME, so neither do we.
  if (process.env.HF_HUB_CACHE) return process.env.HF_HUB_CACHE;
  if (process.env.HF_HOME) return join(process.env.HF_HOME, "hub");
  return join(homedir(), ".cache", "huggingface", "hub");
}

export function cacheFreeSpaceSummary(cacheDir: string): string {
  try {
    const stat = statfsSync(cacheDir);
    return `free=${formatBytes(stat.bavail * stat.bsize)}`;
  } catch {
    return "free=unknown";
  }
}

export async function ensureLocalSttRuntime(opts: {
  backendLabel: string;
  checkPython: string;
  bootstrapTask: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const check = () =>
    execFileAsync(PIXI_COMMAND, [...PIXI_PYTHON_ARGS, "-c", opts.checkPython], {
      cwd: process.cwd(),
      timeout: 30_000,
    });

  try {
    await check();
    return { ok: true };
  } catch (checkError) {
    try {
      await execFileAsync(
        PIXI_COMMAND,
        ["run", "-e", PIXI_STT_ENV, opts.bootstrapTask],
        { cwd: process.cwd(), timeout: LOCAL_STT_BOOTSTRAP_TIMEOUT_MS },
      );
      await check();
      return { ok: true };
    } catch (bootstrapError) {
      return {
        ok: false,
        reason: `${opts.backendLabel} pixi environment is not ready. ${localSttReadyHint(opts.bootstrapTask)} Initial check: ${summarizeChildError(checkError)} Bootstrap: ${summarizeChildError(bootstrapError)}`,
      };
    }
  }
}

export function summarizeChildError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as {
      code?: unknown;
      message?: unknown;
      stderr?: unknown;
    };
    const stderr =
      typeof record.stderr === "string" ? record.stderr.trim() : "";
    if (stderr) return stderr.split("\n").slice(-4).join(" ");
    if (typeof record.code === "string" && typeof record.message === "string") {
      return `${record.code}: ${record.message}`;
    }
    if (typeof record.message === "string") return record.message;
  }
  return String(error);
}
