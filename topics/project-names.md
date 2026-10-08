# Project Names

> A project's name is the last component of its path unless the user chose
> another when adding it. The Projects add form shows the name and code the
> project will get and lets both be changed before the project exists; a
> chosen name is app-data metadata applied wherever the project is named.

Topic: project-names

Status: **implemented (2026-09-20).**

## User-visible contract

- **Adding a project** takes a path, a name, and, when Short Project Code
  Names are enabled in this browser, a code. The name and code follow the
  path as it is typed: the name is the path's last component and the code is
  the same allocation the server would make from that name against the
  projects already listed. Typing into either field detaches it from the
  path. An emptied field stays empty while the user edits it, so a
  replacement can be typed from scratch; left empty, it shows the default
  again when focus leaves it and submits as the default. The defaults are
  visible values, not placeholders, so a user who wants them submits without
  touching them.
- **Paths from names.** Nobody has to know a path to add a project, on
  Projects or in the new session project field. The base directory is the
  host home (`~`), or a limited user's project root.
  - Until the path field is typed into, a typed name derives the path as it
    is typed: the base plus a directory name that is the name lowercased,
    with each run of characters other than letters, digits, `.`, `_` and
    `-` turned into one `-`, cut to 40 characters.
  - A name matching an existing project's name, ignoring case, means that
    project: the path is its path, and adding it again renames nothing.
  - A derived directory name that a listed project already uses, including
    a collision that only truncation created, gets a `-2`, `-3`, …
    suffix. Only listed projects are checked; the client cannot see other
    directories, and an existing unlisted directory is added as it is.
  - When focus leaves the path field, or the form is submitted, the entry
    settles and the field shows the path the server will get. An absolute
    or `~` path stands as typed. A description (whitespace and no path
    separator) moves to an untouched name field, and the path follows the
    name as above. Any other relative entry, such as `story1` or
    `code/story1`, lands under the base. Emptying the path field returns
    it to following the name.
  - **New project** in New session is the one entry point for a folder YA
    has not seen. Its button opens a panel with a single name-or-path
    field, settled as above, and a starting-point palette whose first
    choice, **Empty folder**, is selected by default; ready templates
    follow it (see [project templates](project-templates.md#creation-and-preparation)).
    An entry in the project search that matches no listed project opens
    the same panel for that entry, the search box serving as its path
    field; there is no separate typed-path row. Opening the panel from its
    button carries such an entry into its field. Closing and reopening it
    keeps the entry and choice; choosing a listed project or No project
    closes it.
  - The chooser's summary names the project the panel will start (the
    description, else the settled path's last folder), not the selection
    it replaced: a selected `draft` overtyped with `~/math` previews
    `math`, the name the session lands in.
  - With Empty folder, starting the session creates exactly one folder,
    initializes Git in it unless **Initialize Git repository** is cleared,
    adds the project, and starts there; a notice says whether the folder
    was created or already existed. A missing parent is refused rather
    than created (a limited user's own project root is still made on first
    use). An existing folder is added as it is, never initialized. The
    Git choice is remembered in the browser. Servers without
    `project-creation-git-choice` always initialize Git; there the box is
    checked and disabled and no choice is sent.
- A name that still equals the path's last component is no override. Only a
  differing name is stored; renaming the directory later therefore changes
  the name of a project that was never explicitly named.
- A chosen name is the project's name everywhere: project cards, sidebar
  rows, session breadcrumbs, All Sessions and Inbox rows and the All
  Sessions project filter, recents, the Agents page's live processes, a new
  session's live sidebar insert, sessions detected from another program,
  push notifications, the project named on a new public share, and the
  source name the code-name allocator reads. A rename takes effect on the
  next read of each surface; no session file is reread for it. A chosen
  code takes the same path as an explicit edit on Projects, so it wins over
  the generated value and displaces a conflicting project's generated code.
- Two records keep the name they were written with: an existing public
  share, whose snapshot is immutable, and token-usage ledger entries, which
  are durable history.
- Confirming the form opens a new session in the project. A just-added
  project has no sessions to list, so the earlier landing on its empty All
  Sessions view was a detour.
- Removing a project drops its chosen name with its other metadata; adding
  the path again starts from the path's own name.
- Project list changes are announced. Adding, removing, or renaming a project
  emits `projects-changed`, which refreshes project lists, advances the
  global session collection, and makes an open All Sessions view refetch,
  so its rows and project filter neither keep a removed project or old name
  nor miss a new one.
- The name is invalid when longer than 80 characters after collapsing
  whitespace; a rejected request adds nothing. The code follows the
  [code-name rules](project-code-names.md#character-and-editing-rules), and
  the form checks it before sending.

## Storage and compatibility

The override lives in `projectNames` of `project-metadata.json`, never inside
the project directory ([project directory storage](project-directory-storage.md)
posture, as for [code names](project-code-names.md) and
[captions](project-captions.md)). `ProjectMetadataService`
`getProjectDisplayName` owns the resolution — the chosen name, else
`getProjectName` of the path — and every server surface that names a
project from its path takes it as a `ProjectDisplayNameResolver`. The scanner
keeps the path-derived name in its snapshot and applies the override on every
read. Retained session-catalog rows store the name their file was read under,
so the collection projection names each row afresh rather than trusting the
stored `projectName`. A rename therefore needs no rescan.

An approved, unimplemented extension would also record a deliberate
post-creation rename in the project itself; see
[project captions § Approved project-local identity extension](project-captions.md#approved-project-local-identity-extension-not-implemented).

Capability `project-names` (permanent ID 80, version-implied from `0.8.2`)
owns the `name` and `codeName` request fields on `POST /api/projects`,
`PATCH /api/projects/:projectId/name` (a string sets, empty or `null` clears;
the id must name a listed project, else 404 and nothing is stored), and the
`projects-changed` event. A limited user may rename only a project they own
([limited users](limited-users.md) § Authorization). The reviewed older server corpus is v0.8.0
and v0.8.1; without the capability the add form is path-only, the client sends
neither field, and the project takes its path name as before. An older server
that received the fields would ignore them and add the project under its path
name, which is why the fields are gated rather than sent optimistically.

## Related contracts

- [`project-code-names.md`](project-code-names.md) — allocation and editing
  rules the form's code field follows.
- [`project-captions.md`](project-captions.md) — the description shown under
  the name on Projects.
- [`all-session-content-search.md`](all-session-content-search.md) — the All
  Sessions project filter that this event keeps current.
