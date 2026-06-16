import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export const PIXI_COMMAND = "pixi";
export const PIXI_STT_ENV = "stt";
export const PIXI_PYTHON_ARGS = ["run", "--frozen", "-e", PIXI_STT_ENV, "python"];
const LOCAL_STT_BOOTSTRAP_TIMEOUT_MS = 20 * 60_000;

export function localSttReadyHint(task: string): string {
  return `Run \`pixi run -e ${PIXI_STT_ENV} ${task}\` from the YA checkout, then restart YA.`;
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
