/**
 * Turn what someone typed as a project — in the Projects add form or the new
 * session project field — into a project path.
 *
 * Contract: topics/project-names.md § Paths from names. Anything that is not
 * already an absolute or `~` path lands under a base directory — the host
 * home (`~`, expanded by the server) or a limited user's project root — so a
 * bare name or a sentence typed by someone who does not think in paths still
 * names a real directory the server will accept.
 */

import type { ActingPrincipal } from "@yep-anywhere/shared";

/** Longest directory name derived from a typed name. */
export const MAX_DERIVED_DIR_NAME_LENGTH = 40;

/**
 * Where typed names land: a limited user's project root, the only place they
 * may create projects, else the host home.
 */
export function newProjectBaseFor(principal: ActingPrincipal): string {
  return principal.grants?.projectRoot || "~";
}

/** Whether `text` already names a location without a base directory. */
export function isAnchoredPath(text: string): boolean {
  return (
    text.startsWith("/") ||
    text.startsWith("~") ||
    text.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(text)
  );
}

/**
 * Whether `text` reads as a description rather than a path: it contains
 * whitespace, and no path separator or anchor says otherwise.
 */
export function isProjectDescription(text: string): boolean {
  const trimmed = text.trim();
  return (
    /\s/.test(trimmed) && !/[/\\]/.test(trimmed) && !isAnchoredPath(trimmed)
  );
}

/**
 * A short directory name for a typed name: lowercase, and each run of
 * anything but letters, digits, `.`, `_` and `-` becomes one `-`, which every
 * platform accepts in a directory name.
 */
export function directoryNameFor(name: string): string {
  const edges = /^[-_.]+|[-_.]+$/g;
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(edges, "")
    .slice(0, MAX_DERIVED_DIR_NAME_LENGTH)
    .replace(edges, "");
}

/** `relative` beneath `base`, joined with the separator `base` uses. */
export function joinUnderBase(base: string, relative: string): string {
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base.replace(/[/\\]+$/, "")}${separator}${relative.replace(/^[/\\]+/, "")}`;
}

interface NamedProject {
  path: string;
  name: string;
}

function lastPathComponent(path: string): string {
  return (
    path
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() ?? ""
  );
}

/**
 * The path a project name stands for. Typing an existing project's name
 * again (ignoring case) means that project, so it keeps its own path.
 * Anything else is a new directory under `base`; when a known project
 * already uses that directory name — two long descriptions cut to the same
 * prefix, say — a `-2`, `-3`, … suffix keeps the new project separate.
 * Only known projects are checked: the client cannot see other directories.
 * Empty when the name yields no usable directory name.
 */
export function pathForProjectName(
  name: string,
  base: string,
  projects: readonly NamedProject[],
  reuseExisting = true,
): string {
  const key = name.trim().toLowerCase();
  if (!key) return "";
  const existing = projects.find(
    (project) => project.name.trim().toLowerCase() === key,
  );
  if (reuseExisting && existing) return existing.path;
  const directory = directoryNameFor(name);
  if (!directory) return "";
  const taken = new Set(
    projects.map((project) => lastPathComponent(project.path).toLowerCase()),
  );
  let candidate = directory;
  for (let n = 2; taken.has(candidate); n++) {
    const suffix = `-${n}`;
    candidate = `${directory
      .slice(0, MAX_DERIVED_DIR_NAME_LENGTH - suffix.length)
      .replace(/[-_.]+$/, "")}${suffix}`;
  }
  return joinUnderBase(base, candidate);
}

export interface SettledPathEntry {
  path: string;
  /** The typed description, when the path box held one instead of a path. */
  name?: string;
}

/** The name a project started at `entry` gets: its description, else its folder. */
export function projectNameForEntry(entry: SettledPathEntry): string {
  return entry.name ?? lastPathComponent(entry.path);
}

/**
 * What a finished path-box entry means. An anchored path stands as typed; a
 * description is a project name whose path is derived; any other relative
 * entry, such as `story1` or `code/story1`, lands under `base`.
 */
export function settlePathEntry(
  text: string,
  base: string,
  projects: readonly NamedProject[],
): SettledPathEntry {
  const trimmed = text.trim();
  if (!trimmed || isAnchoredPath(trimmed)) return { path: trimmed };
  if (isProjectDescription(trimmed)) {
    return { path: pathForProjectName(trimmed, base, projects), name: trimmed };
  }
  return { path: joinUnderBase(base, trimmed) };
}
