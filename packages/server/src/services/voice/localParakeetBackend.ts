import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getLogger } from "../../logging/logger.js";
import type { SpeechBackend, TranscribeOptions } from "./SpeechBackend.js";
import {
  execFileAsync,
  localSttReadyHint,
  PIXI_COMMAND,
  PIXI_PYTHON_ARGS,
  PIXI_STT_ENV,
  summarizeChildError,
} from "./localSttRuntime.js";

const logger = getLogger();

const WORKER_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "parakeet_worker.py",
);

const PIXI_STT_READY_HINT = localSttReadyHint("stt-bootstrap-parakeet");

/** Milliseconds to wait for model load before giving up. */
const MODEL_LOAD_TIMEOUT_MS = 180_000;

export class LocalParakeetBackend implements SpeechBackend {
  readonly id = "ya-parakeet";
  readonly label = "Local Parakeet (pixi stt)";

  private readonly model: string;
  private readonly device: string;

  private proc: ChildProcess | null = null;
  private warmPromise: Promise<void> | null = null;
  private pendingResolve: ((text: string) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;

  constructor(opts: { model?: string; device?: string } = {}) {
    this.model = opts.model ?? "nvidia/parakeet-tdt-0.6b-v3";
    this.device = opts.device ?? "auto";
  }

  async validate(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await execFileAsync(
        PIXI_COMMAND,
        [
          ...PIXI_PYTHON_ARGS,
          "-c",
          "import torch; from transformers import pipeline",
        ],
        { cwd: process.cwd(), timeout: 30_000 },
      );
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: `local Parakeet pixi environment is not ready. ${PIXI_STT_READY_HINT} Detail: ${summarizeChildError(error)}`,
      };
    }
  }

  private startWorker(): Promise<void> {
    if (this.warmPromise) return this.warmPromise;

    this.warmPromise = new Promise<void>((resolve, reject) => {
      logger.info(
        `Starting parakeet worker via pixi env "${PIXI_STT_ENV}" (model=${this.model} device=${this.device})`,
      );

      const proc = spawn(
        PIXI_COMMAND,
        [...PIXI_PYTHON_ARGS, WORKER_SCRIPT, this.model, this.device],
        { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
      );
      this.proc = proc;

      let ready = false;
      let loadTimeout: NodeJS.Timeout | null = null;

      proc.stderr?.on("data", (chunk: Buffer) => {
        logger.debug(`[parakeet] ${chunk.toString().trim()}`);
      });

      proc.on("error", (error) => {
        if (!ready) {
          if (loadTimeout) clearTimeout(loadTimeout);
          reject(error);
        }
      });

      proc.on("exit", (code) => {
        logger.warn(`Parakeet worker exited (code=${code})`);
        this.proc = null;
        this.warmPromise = null;
        if (this.pendingReject) {
          this.pendingReject(new Error("Parakeet worker exited unexpectedly"));
          this.pendingResolve = null;
          this.pendingReject = null;
        }
      });

      const rl = createInterface({ input: proc.stdout! });

      loadTimeout = setTimeout(() => {
        if (!ready) {
          reject(new Error("Parakeet model load timed out"));
          proc.kill();
        }
      }, MODEL_LOAD_TIMEOUT_MS);

      rl.on("line", (line: string) => {
        try {
          const msg = JSON.parse(line) as {
            status?: string;
            text?: string;
            error?: string;
          };

          if (!ready) {
            clearTimeout(loadTimeout);
            if (msg.status === "ready") {
              ready = true;
              resolve();
            } else {
              reject(new Error(msg.error ?? "Worker failed to start"));
            }
            return;
          }

          if (this.pendingResolve && this.pendingReject) {
            if (msg.error) {
              this.pendingReject(new Error(msg.error));
            } else {
              this.pendingResolve(msg.text ?? "");
            }
            this.pendingResolve = null;
            this.pendingReject = null;
          }
        } catch {
          logger.warn(`Unparseable parakeet output: ${line}`);
        }
      });
    });

    return this.warmPromise;
  }

  async transcribe(audio: Buffer, options: TranscribeOptions = {}): Promise<string> {
    if (this.pendingResolve) {
      throw new Error("Parakeet backend is busy with another request");
    }

    await this.startWorker();

    if (!this.proc?.stdin) {
      throw new Error("Parakeet worker is not running");
    }

    return new Promise<string>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      const req = {
        audio_b64: audio.toString("base64"),
        mime_type: options.mimeType ?? "audio/webm;codecs=opus",
      };

      this.proc!.stdin!.write(`${JSON.stringify(req)}\n`);
    });
  }
}
