# 018 — File access scoping for the HTTP file doors

## Problem

YA serves local files over HTTP through several routes. Two of them ("doors")
historically had **different** access policies:

- **Project files door** — `/api/projects/:id/files` + `/files/raw`
  (`routes/files.ts`, `resolveFilePath`). Relative paths are project-scoped, but
  **absolute and `~` paths were accepted with no allow-list** — effectively the
  *entire disk the server process can read* (`~/.ssh`, anything). Justified
  historically as "the operator can read host files through the agent anyway."
- **Media doors** — `/api/local-image`, `/api/local-file`
  (`routes/local-resource-policy.ts`). Scoped to an allow-list = configured safe
  dirs (`ALLOWED_IMAGE_PATHS`, default `/tmp`) ∪ scanned project paths.

Two problems with this asymmetry:

1. **Security.** The "agent can read it anyway" premise is false for sandboxed
   agents, remote/SSH executors, or locked-down provider configs. The HTTP door
   is then a *separate* attack surface — a stolen session cookie or relay-path
   bug could `GET` `~/.ssh/id_rsa` even when the agent itself is jailed. This is
   defense-in-depth for the HTTP/viewer layer; it does **not** claim to constrain
   the agent.
2. **A real bug.** Because the doors disagreed, a `C:\tmp` image read by the
   agent (a tool-result link → project-files door) resolved differently than the
   same path via the media door, producing fixed image 404s
   (see `topics/media-rendering-and-routing.md`).

## Design: one effective allow-set, both doors, user-controlled

A single persisted setting governs an **effective set of allowed path prefixes**
that **both** doors enforce. Modeled as independent, additive checkboxes (not a
radio) plus a free-form list — each box turns one source on:

| Source     | Default | Expands to                                   |
|------------|---------|----------------------------------------------|
| `projects` | on      | all scanned project paths (via the scanner)  |
| `uploads`  | on      | the managed uploads dir                      |
| `temp`     | on      | `getDefaultAllowedImagePaths()` (per-OS temp)|
| `home`     | **off** | `os.homedir()`                               |
| `custom`   | `[]`    | literal absolute paths (one per line, `~` ok)|

Effective set = union of every enabled source. A path is served iff its
realpath-resolved location is inside one of those prefixes (symlink-escape safe,
inherited from `local-resource-policy.ts`).

"Home folder" is a named alias checkbox so nobody types their home path; "entire
disk" isn't a checkbox — you opt into it by adding `/` (or a drive root) to the
custom list, which the UI flags as a danger row.

### Precedence (three tiers)

1. **Env `ALLOWED_FILE_PATHS`** (alias: legacy `ALLOWED_IMAGE_PATHS`) — if set,
   it **replaces** the computed set and the UI block renders read-only with a
   "set via ALLOWED_FILE_PATHS" hint. `ALLOWED_FILE_PATHS` wins if both are set.
   Empty string = no extra paths. (Uploads + projects are still unioned in, as
   today, so env mode never strands managed uploads.)
2. **Persisted `fileAccess` setting** — the checkbox/custom model above, editable
   in the UI when no env var is set.
3. **Built-in defaults** — `{projects, uploads, temp}` on, `home` off, no custom.
   Used when no setting has been saved yet.

### What stays unchanged

- **Relative (in-project) paths** on the files route remain project-scoped and
  symlink-checked exactly as before — independent of the allow-set. So the
  current project's own files always open via the viewer even if `projects` is
  unchecked; the `projects` checkbox only governs whether *absolute* paths that
  land inside *some* scanned project are allowed.
- Uploads served via `/api/.../upload/:filename` and share routes are unaffected
  (different routes, different policies).

## Migration (breaking, secure-by-default)

Existing installs have **no** `fileAccess` setting, so they fall to tier 3
defaults: `home` off, no custom. That means **absolute/`~` files outside
projects/uploads/temp stop opening over HTTP until the user re-enables them**
(check "Home folder" or add a custom path). This is an intentional security
tightening, called out in CHANGELOG. We chose secure-default over grandfathering
because the prior behavior (whole-disk HTTP read) is the thing being fixed.

The `C:\tmp` Windows default in `getDefaultAllowedImagePaths()` is dropped at the
same time (it never existed by default and `/tmp` is meaningless on Windows);
Windows temp now resolves through `os.tmpdir()`. Anyone relying on implicit
`C:\tmp` allow on Windows must add it to the custom list.

## Implementation map

- **`config.ts`** — `getDefaultAllowedImagePaths()` cleaned up per-OS; read
  `ALLOWED_FILE_PATHS` ?? `ALLOWED_IMAGE_PATHS` for the env override.
- **`middleware/file-access.ts`** (new, mirrors `allowed-hosts.ts`) — holds the
  live `fileAccess` settings + resolved deps (uploadsDir, tempPaths, homeDir, env
  override); `updateFileAccess(settings)`, `getAllowedFilePaths()`,
  `shouldIncludeProjects()`, `isFileAccessEnvPinned()`.
- **`routes/local-resource-policy.ts`** — `allowedPaths` may be a getter
  function; new `includeProjects?: () => boolean` gates the scanner-projects
  union; per-call resolution (no stale cache) since the set is now live.
- **`routes/files.ts`** — the absolute/`~` branch resolves through the shared
  policy (gains symlink-escape protection); denied → `null` (404/403 as today).
- **`routes/settings.ts`** — parse/validate `fileAccess`; `onFileAccessChanged`
  runtime callback; `GET /api/settings/file-access` exposes `{ envPinned,
  tempPaths, uploadsDir, homeDir }` for UI hints/read-only state.
- **`index.ts`** — seed `updateFileAccess(...)` from persisted settings at
  startup (next to `updateAllowedHosts`).
- **`app.ts`** — all three doors built from the same live provider; media doors
  mount unconditionally now (uploads guarantees a non-empty set).
- **client `LocalAccessSettings.tsx`** — new "File access" group; checkboxes +
  custom textarea; env-pinned read-only; temp-paths hint; i18n.

See also `topics/media-rendering-and-routing.md` (doors section).
