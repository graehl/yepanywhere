/**
 * Project names: the label a project shows everywhere a project is named.
 *
 * By default the name is the last path component of the project directory.
 * A user may choose a different name when adding the project or later; the
 * override lives in YA app data, never inside the project directory. See
 * topics/project-names.md.
 */

export const MAX_PROJECT_NAME_LENGTH = 80;

/**
 * Emitted when the set of projects or a project's chosen name changes: a
 * project was added, removed, or renamed. Listeners that cache project lists
 * or names refetch.
 */
export interface ProjectsChangedEvent {
  type: "projects-changed";
  projectIds: string[];
  /** A retained enumeration settled, including an empty visible collection. */
  collectionRefresh?: true;
  timestamp: string;
}

/**
 * Collapse whitespace and enforce the name length limit. Returns an empty
 * string for blank input so callers can treat it as "clear the override".
 */
export function normalizeProjectName(value: string): string {
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    throw new RangeError(
      `Project name must be at most ${MAX_PROJECT_NAME_LENGTH} characters`,
    );
  }
  return name;
}

/**
 * The name a path would get without an override: its last component. Both
 * slash styles are accepted because a client may type a Windows path.
 */
export function defaultProjectNameForPath(path: string): string {
  const trimmed = path.trim().replace(/[/\\]+$/, "");
  const separator = Math.max(
    trimmed.lastIndexOf("/"),
    trimmed.lastIndexOf("\\"),
  );
  return separator === -1 ? trimmed : trimmed.slice(separator + 1);
}
