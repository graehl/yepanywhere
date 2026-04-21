import { getLogger } from "../logging/logger.js";
import { detectCodexCli } from "../sdk/cli-detection.js";

const GITHUB_LATEST_URL =
  "https://api.github.com/repos/openai/codex/releases/latest";
const DEFAULT_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;

const log = getLogger().child({ component: "codex-update-checker" });

export interface CodexUpdateStatus {
  installed: string | null;
  installedPath: string | null;
  latest: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
  lastCheckedAt: number | null;
  error: string | null;
}

export interface CodexUpdateCheckerOptions {
  /** Override the remote fetch (for tests). */
  fetchLatest?: () => Promise<{ tagName: string | null; htmlUrl: string | null }>;
  /** Override the local CLI detection (for tests). */
  detectInstalled?: () => Promise<{
    version: string | null;
    path: string | null;
  }>;
  /** Refresh TTL in ms (default: 24h). */
  refreshTtlMs?: number;
}

const INITIAL_STATUS: CodexUpdateStatus = {
  installed: null,
  installedPath: null,
  latest: null,
  releaseUrl: null,
  updateAvailable: false,
  lastCheckedAt: null,
  error: null,
};

export class CodexUpdateChecker {
  private status: CodexUpdateStatus = INITIAL_STATUS;
  private inflight: Promise<CodexUpdateStatus> | null = null;
  private readonly fetchLatest: NonNullable<
    CodexUpdateCheckerOptions["fetchLatest"]
  >;
  private readonly detectInstalled: NonNullable<
    CodexUpdateCheckerOptions["detectInstalled"]
  >;
  private readonly refreshTtlMs: number;

  constructor(options: CodexUpdateCheckerOptions = {}) {
    this.fetchLatest = options.fetchLatest ?? fetchLatestFromGitHub;
    this.detectInstalled = options.detectInstalled ?? detectInstalledFromCli;
    this.refreshTtlMs = options.refreshTtlMs ?? DEFAULT_REFRESH_TTL_MS;
  }

  async getStatus(options?: { force?: boolean }): Promise<CodexUpdateStatus> {
    const stale =
      options?.force === true ||
      this.status.lastCheckedAt === null ||
      Date.now() - this.status.lastCheckedAt > this.refreshTtlMs;
    if (stale) {
      await this.refresh();
    }
    return { ...this.status };
  }

  async refresh(): Promise<CodexUpdateStatus> {
    if (this.inflight) return this.inflight;
    this.inflight = this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<CodexUpdateStatus> {
    let installed: string | null = null;
    let installedPath: string | null = null;
    try {
      const info = await this.detectInstalled();
      installed = normalizeVersion(info.version);
      installedPath = info.path;
    } catch (error) {
      log.debug({ error }, "detectInstalled failed");
    }

    let latest: string | null = null;
    let releaseUrl: string | null = null;
    let error: string | null = null;
    try {
      const result = await this.fetchLatest();
      latest = normalizeVersion(result.tagName);
      releaseUrl = result.htmlUrl;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      log.debug({ error: e }, "fetchLatest failed");
    }

    const updateAvailable =
      installed !== null &&
      latest !== null &&
      compareVersions(installed, latest) < 0;

    this.status = {
      installed,
      installedPath,
      latest,
      releaseUrl,
      updateAvailable,
      lastCheckedAt: Date.now(),
      error,
    };
    return { ...this.status };
  }
}

async function detectInstalledFromCli(): Promise<{
  version: string | null;
  path: string | null;
}> {
  const info = await detectCodexCli();
  return {
    version: info.version ?? null,
    path: info.path ?? null,
  };
}

async function fetchLatestFromGitHub(): Promise<{
  tagName: string | null;
  htmlUrl: string | null;
}> {
  const res = await fetch(GITHUB_LATEST_URL, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "yep-anywhere-update-checker",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status}`);
  }
  const body = (await res.json()) as {
    tag_name?: unknown;
    html_url?: unknown;
  };
  return {
    tagName: typeof body.tag_name === "string" ? body.tag_name : null,
    htmlUrl: typeof body.html_url === "string" ? body.html_url : null,
  };
}

function normalizeVersion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/);
  if (!match) return null;
  const [, major, minor, patch, pre] = match;
  return pre ? `${major}.${minor}.${patch}-${pre}` : `${major}.${minor}.${patch}`;
}

function compareVersions(a: string, b: string): number {
  const pa = splitVersion(a);
  const pb = splitVersion(b);
  for (let i = 0; i < 3; i++) {
    const av = pa.parts[i] ?? 0;
    const bv = pb.parts[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
}

function splitVersion(v: string): { parts: number[]; pre: string | null } {
  const dash = v.indexOf("-");
  const core = dash === -1 ? v : v.slice(0, dash);
  const pre = dash === -1 ? null : v.slice(dash + 1);
  const parts = core.split(".").map((n) => {
    const parsed = Number.parseInt(n, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return { parts, pre };
}

export const __testing__ = { normalizeVersion, compareVersions };
