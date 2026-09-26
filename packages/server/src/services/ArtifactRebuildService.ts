import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { writeFileAtomically } from "../utils/writeFileAtomically.js";

/**
 * Regeneration hooks for edited artifacts.
 *
 * An artifact HTML file may carry a `ya-artifact:v1` comment naming a hook and
 * proposing the command that rebuilds it. Discovery never authorizes
 * execution: a run uses only a registration the user explicitly approved,
 * stored in app data and keyed by the artifact's canonical path and hook id.
 * A proposal that differs from the approved registration invalidates it, so
 * a changed comment cannot run a different command under an old approval.
 */

const registrationSchema = z.object({
  cwd: z.string().min(1).max(4096).refine(isAbsolute, "cwd must be absolute"),
  argv: z.array(z.string().min(1).max(4096)).min(1).max(64),
  outputs: z.array(z.string().min(1).max(4096)).max(64).default([]),
  timeoutSeconds: z.number().int().min(1).max(3600).default(180),
});
/** The exact proposal a user was shown and approved, versioned. */
export const rebuildApprovalSchema = registrationSchema.extend({
  registrationVersion: z.number().int().min(1),
});
export type RebuildApproval = z.infer<typeof rebuildApprovalSchema>;

const descriptorSchema = z.object({
  hook: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i),
  registrationVersion: z.number().int().min(1),
  proposedRegistration: registrationSchema.optional(),
});
export type RebuildDescriptor = z.infer<typeof descriptorSchema>;

export interface RebuildStatus extends RebuildDescriptor {
  /** An approved registration exists for this artifact and hook. */
  registered: boolean;
  /** That registration equals the descriptor's version and proposal. */
  matches: boolean;
}

export interface RebuildResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  /** Bounded tail of interleaved stdout and stderr. */
  log: string;
}

type StoredRegistration = RebuildApproval & { approvedAt: string };

const LOG_LIMIT = 64 * 1024;
const KILL_GRACE_MS = 5000;

/** Read the first `ya-artifact:v1` HTML comment; malformed JSON is no descriptor. */
export function parseArtifactRebuildDescriptor(
  html: string,
): RebuildDescriptor | undefined {
  const match = /<!--\s*ya-artifact:v1\s+([\s\S]*?)-->/.exec(html);
  if (!match?.[1]) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(match[1].trim());
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || !("regenerate" in value))
    return undefined;
  const parsed = descriptorSchema.safeParse(
    (value as { regenerate: unknown }).regenerate,
  );
  return parsed.success ? parsed.data : undefined;
}

function sameRegistration(
  stored: RebuildApproval,
  descriptor: RebuildDescriptor,
): boolean {
  const proposal = descriptor.proposedRegistration;
  if (
    !proposal ||
    stored.registrationVersion !== descriptor.registrationVersion
  )
    return false;
  return (
    stored.cwd === proposal.cwd &&
    stored.timeoutSeconds === proposal.timeoutSeconds &&
    stored.argv.length === proposal.argv.length &&
    stored.argv.every((item, index) => item === proposal.argv[index]) &&
    stored.outputs.length === proposal.outputs.length &&
    stored.outputs.every((item, index) => item === proposal.outputs[index])
  );
}

export class ArtifactRebuildService {
  private registrations: Map<string, StoredRegistration> | undefined;
  private readonly running = new Map<string, Promise<RebuildResult>>();
  private persisting: Promise<void> = Promise.resolve();

  constructor(private readonly stateDir: string) {}

  private get file(): string {
    return join(this.stateDir, "rebuild-hooks.json");
  }

  private key(artifactPath: string, hook: string): string {
    return `${artifactPath}\n${hook}`;
  }

  private async load(): Promise<Map<string, StoredRegistration>> {
    if (this.registrations) return this.registrations;
    const map = new Map<string, StoredRegistration>();
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as unknown;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw)) {
          const parsed = rebuildApprovalSchema
            .extend({ approvedAt: z.string() })
            .safeParse(value);
          if (parsed.success) map.set(key, parsed.data);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.registrations = map;
    return map;
  }

  private persist(): Promise<void> {
    const snapshot = Object.fromEntries(this.registrations ?? []);
    this.persisting = this.persisting.then(async () => {
      await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
      await writeFileAtomically(
        this.file,
        `${JSON.stringify(snapshot, null, 2)}\n`,
      );
    });
    return this.persisting;
  }

  async status(
    artifactPath: string,
    descriptor: RebuildDescriptor,
  ): Promise<RebuildStatus> {
    const stored = (await this.load()).get(
      this.key(artifactPath, descriptor.hook),
    );
    return {
      ...descriptor,
      registered: stored !== undefined,
      matches: stored !== undefined && sameRegistration(stored, descriptor),
    };
  }

  /**
   * Record the user's approval as this artifact's registration, but only
   * when the descriptor still proposes exactly what was approved. Returns
   * undefined, registering nothing, when the proposal changed after the user
   * saw it: an approval never transfers to a command the user was not shown.
   */
  async register(
    artifactPath: string,
    descriptor: RebuildDescriptor,
    approval: RebuildApproval,
  ): Promise<RebuildStatus | undefined> {
    if (!sameRegistration(approval, descriptor)) return undefined;
    if (!descriptor.proposedRegistration)
      throw new Error("This artifact proposes no rebuild command to register");
    const map = await this.load();
    map.set(this.key(artifactPath, descriptor.hook), {
      ...descriptor.proposedRegistration,
      registrationVersion: descriptor.registrationVersion,
      approvedAt: new Date().toISOString(),
    });
    await this.persist();
    return this.status(artifactPath, descriptor);
  }

  async unregister(artifactPath: string, hook: string): Promise<void> {
    const map = await this.load();
    if (map.delete(this.key(artifactPath, hook))) await this.persist();
  }

  isRunning(artifactPath: string, hook: string): boolean {
    return this.running.has(this.key(artifactPath, hook));
  }

  /**
   * Run the approved registration once. A second request while one is in
   * flight for the same artifact and hook joins that run instead of stacking
   * another process.
   */
  async run(
    artifactPath: string,
    descriptor: RebuildDescriptor,
  ): Promise<RebuildResult> {
    const key = this.key(artifactPath, descriptor.hook);
    const stored = (await this.load()).get(key);
    if (!stored || !sameRegistration(stored, descriptor))
      throw new Error(
        "This rebuild command is not registered for this artifact; approve it first",
      );
    const inFlight = this.running.get(key);
    if (inFlight) return inFlight;
    const job = execute(stored).finally(() => {
      this.running.delete(key);
    });
    this.running.set(key, job);
    return job;
  }
}

function execute(registration: StoredRegistration): Promise<RebuildResult> {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const [command, ...args] = registration.argv;
    let log = "";
    let timedOut = false;
    let settled = false;
    const append = (chunk: Buffer) => {
      log += chunk.toString("utf8");
      if (log.length > LOG_LIMIT) log = log.slice(log.length - LOG_LIMIT);
    };
    const finish = (result: Omit<RebuildResult, "durationMs" | "log">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolvePromise({ ...result, durationMs: Date.now() - started, log });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command!, args, {
        cwd: registration.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (error) {
      log = error instanceof Error ? error.message : String(error);
      resolvePromise({
        ok: false,
        exitCode: null,
        signal: null,
        timedOut: false,
        durationMs: Date.now() - started,
        log,
      });
      return;
    }
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }, registration.timeoutSeconds * 1000);
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (error) => {
      append(Buffer.from(`\n${error.message}\n`));
      finish({ ok: false, exitCode: null, signal: null, timedOut });
    });
    child.on("close", (exitCode, signal) => {
      finish({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        signal,
        timedOut,
      });
    });
  });
}
