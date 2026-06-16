import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export const PIXI_COMMAND = "pixi";
export const PIXI_STT_ENV = "stt";
export const PIXI_PYTHON_ARGS = ["run", "--frozen", "-e", PIXI_STT_ENV, "python"];

export function localSttReadyHint(task: string): string {
  return `Run \`pixi run -e ${PIXI_STT_ENV} ${task}\` from the YA checkout, then restart YA.`;
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
