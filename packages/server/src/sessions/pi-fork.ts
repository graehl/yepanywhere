import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface PiSessionHeader extends Record<string, unknown> {
  type?: string;
  id?: string;
  version?: number;
  timestamp?: string;
  cwd?: string;
}

interface PiSessionEntry extends Record<string, unknown> {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  targetId?: string;
  label?: string;
}

export interface ForkPiSessionOptions {
  sourcePath: string;
  cwd: string;
  upToMessageId?: string;
  newSessionId?: string;
}

export interface ForkPiSessionResult {
  sessionId: string;
  filePath: string;
}

export async function forkPiSessionFile(
  options: ForkPiSessionOptions,
): Promise<ForkPiSessionResult> {
  const { header, entries } = await readPiSessionEntries(options.sourcePath);
  const byId = new Map<string, PiSessionEntry>();
  for (const entry of entries) {
    if (entry.id) {
      byId.set(entry.id, entry);
    }
  }

  const targetId = options.upToMessageId ?? entries.at(-1)?.id;
  if (options.upToMessageId && !byId.has(options.upToMessageId)) {
    throw new Error(
      `Pi fork anchor ${options.upToMessageId} was not found in source session`,
    );
  }

  const branch = targetId ? buildPiBranch(byId, targetId) : [];
  const retainedEntries = rechainPiBranch(branch);
  const labelEntries = buildRetainedPiLabels(entries, retainedEntries);
  const sessionId = options.newSessionId ?? randomUUID();
  const timestamp = new Date().toISOString();
  const fileTimestamp = timestamp.replace(/[:.]/g, "-");
  const filePath = join(
    dirname(options.sourcePath),
    `${fileTimestamp}_${sessionId}.jsonl`,
  );
  const newHeader: PiSessionHeader = {
    type: "session",
    version: typeof header.version === "number" ? header.version : 3,
    id: sessionId,
    timestamp,
    cwd: options.cwd,
    parentSession: options.sourcePath,
  };

  await mkdir(dirname(filePath), { recursive: true });
  const lines = [newHeader, ...retainedEntries, ...labelEntries].map((entry) =>
    JSON.stringify(entry),
  );
  await writeFile(filePath, `${lines.join("\n")}\n`, {
    encoding: "utf-8",
    flag: "wx",
  });

  return { sessionId, filePath };
}

async function readPiSessionEntries(
  sourcePath: string,
): Promise<{ header: PiSessionHeader; entries: PiSessionEntry[] }> {
  const raw = await readFile(sourcePath, "utf-8");
  const parsed: Array<PiSessionHeader | PiSessionEntry> = [];
  let lineNumber = 0;
  for (const line of raw.split(/\r?\n/)) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === "object") {
        parsed.push(value as PiSessionHeader | PiSessionEntry);
      }
    } catch (error) {
      throw new Error(
        `Cannot fork Pi session ${sourcePath}: invalid JSONL at line ${lineNumber}`,
        { cause: error },
      );
    }
  }

  const header = parsed.find((entry) => entry.type === "session");
  if (!header) {
    throw new Error(
      `Cannot fork Pi session ${sourcePath}: missing session header`,
    );
  }

  const entries = parsed.filter(
    (entry): entry is PiSessionEntry =>
      entry.type !== "session" && typeof entry.id === "string",
  );
  return { header, entries };
}

function buildPiBranch(
  byId: Map<string, PiSessionEntry>,
  targetId: string,
): PiSessionEntry[] {
  const path: PiSessionEntry[] = [];
  const seen = new Set<string>();
  let current = byId.get(targetId);
  while (current?.id) {
    if (seen.has(current.id)) {
      throw new Error(`Cannot fork Pi session: cycle at entry ${current.id}`);
    }
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  path.reverse();
  return path;
}

function rechainPiBranch(branch: PiSessionEntry[]): PiSessionEntry[] {
  const retained: PiSessionEntry[] = [];
  let parentId: string | null = null;
  for (const entry of branch) {
    if (entry.type === "label") continue;
    retained.push({ ...entry, parentId });
    parentId = entry.id ?? null;
  }
  return retained;
}

function buildRetainedPiLabels(
  entries: PiSessionEntry[],
  retainedEntries: PiSessionEntry[],
): PiSessionEntry[] {
  const retainedIds = new Set(
    retainedEntries.flatMap((entry) => (entry.id ? [entry.id] : [])),
  );
  const labelsByTarget = new Map<
    string,
    { label: string; timestamp: string | undefined }
  >();

  for (const entry of entries) {
    if (entry.type !== "label" || !entry.targetId) continue;
    if (typeof entry.label === "string" && entry.label.length > 0) {
      labelsByTarget.set(entry.targetId, {
        label: entry.label,
        timestamp: entry.timestamp,
      });
    } else {
      labelsByTarget.delete(entry.targetId);
    }
  }

  const labels: PiSessionEntry[] = [];
  let parentId = retainedEntries.at(-1)?.id ?? null;
  for (const targetId of retainedIds) {
    const label = labelsByTarget.get(targetId);
    if (!label) continue;
    const entry: PiSessionEntry = {
      type: "label",
      id: randomUUID(),
      parentId,
      timestamp: label.timestamp ?? new Date().toISOString(),
      targetId,
      label: label.label,
    };
    labels.push(entry);
    parentId = entry.id ?? null;
  }
  return labels;
}
