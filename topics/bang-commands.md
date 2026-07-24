# `!!` Bang Commands (composer-run local shell commands)

> Proposal: a composer message starting with `!!` runs `command args` as a
> local shell command in the session's project directory, entirely outside
> provider context; the command and its markdown-rendered output persist
> inline as a transcript display object with echo-to-session and
> recall-to-composer actions, tab completion over PATH and project-dir
> executables, and a top-level cross-session bang-command history view.

Topic: bang-commands

Status: proposal (not built).

See also:
[transcript-display-objects](transcript-display-objects.md) (the persistence
and placement mechanism these blocks reuse),
[provider-agnostic-btw-asides](provider-agnostic-btw-asides.md) (precedent for
composer input that is YA-routed rather than sent to the session agent, and
for the visible-routing-before-submission invariant),
[synthetic-turn-injection](synthetic-turn-injection.md) (the contrast: that is
about putting content *into* model context; bang blocks never touch context),
[message-control-steer-queue-btw-later-interrupt](message-control-steer-queue-btw-later-interrupt.md)
(the delivery-intent contract `!!` deliberately sits outside),
[emulated-slash-commands](emulated-slash-commands.md) (the other composer
prefix-routing layer; `!!` must be routed before that layer ever sees it),
[rich-text-rendering](rich-text-rendering.md) (the sanitized markdown and
fenced-output render paths the block output flows through),
[subprocess-environment](subprocess-environment.md) (environment hygiene for
YA-spawned processes),
[public-share-content-censorship](public-share-content-censorship.md) and
[security](security.md) (exec surface gating and share exposure),
[architecture-mandates](architecture-mandates.md) (bounded storage/render
obligations the history view inherits).

## Motivation

YA is a mobile-first supervisor: the operator often has no terminal at hand.
Today a quick `git status`, `pnpm test`, `agentctl active`, or ad-hoc report
script requires either interrupting/steering the agent ("please run X for
me" — a token-costly round-trip that also perturbs the session) or leaving
the phone for a shell. Bang commands give the supervisor a direct hand on the
project directory:

- **Zero session interference.** A bang command never becomes a turn, never
  enters provider context, is never replayed on resume, and is invisible to
  the agent unless the user explicitly echoes it in. It therefore runs
  immediately regardless of session state — busy, waiting, compacting — with
  no steer/queue/defer semantics.
- **A persistent inline record.** The command and output appear at the
  transcript position where they were run, documenting what the human
  checked and when, interleaved with the agent work it was checking.
- **Agent-tool synergy.** The same acli-style tools built for agents
  (`~/agents` `topics/agent-cli.md`; `agentctl` is the flagship) are exactly
  the compact, non-interactive commands a phone-bound supervisor wants.

## Contracts

- **`!!` is YA-routed, never provider ingress.** The routing decision happens
  before the emulated-slash-command rewrite layer and before any queue/steer
  classification. An unsupported surface (e.g. a share page) must reject the
  send visibly, never forward `!!...` to the provider as prompt text.
- **Visible routing before submission.** When the draft starts with `!!`, the
  composer shows a routing chip ("local command — not sent to agent") before
  send, mirroring the `/btw` invariant that routing state is shown, not
  inferred.
- **Execution.** Server-side, `cwd` = the session's project directory.
  Command resolution: PATH first, then the project directory as an implicit
  final PATH entry (a project-root executable `foo` runs as `./foo`; no
  subdirectory search). The line runs with shell semantics (`bash -c`) so
  pipes, globs, and redirects work — the acli composition story assumes
  pipeable verbs, and argv-only execution would break `A | B`.
- **Trust boundary.** No new one: YA already executes arbitrary code as the
  server user via agent sessions. Bang exec is gated by the same
  authentication as sending a turn (owner clients over direct or E2E relay
  transport), and is absent — UI and API — from public share surfaces.
  Bang history blocks are session content for censorship purposes: share
  rendering and redaction rules apply to them like any other block.
- **Environment hygiene.** Inherit the server's baseline subprocess
  environment, but scrub agent-session identity markers
  (`AGENTCTL_SESSION_ID`, harness vars) so a bang-run `agentctl` never
  adopts an agent session's identity or registers as agent work.
- **Result block.** Shows the command line, exit code, duration, and output;
  stderr is kept distinguishable (collapsed when empty). Non-zero exit gets
  error styling. A running block streams output with a cancel control;
  streamed updates must be coalesced/rate-limited before reaching React
  (bursty command output is exactly the high-rate path the client
  performance rules cover).
- **Persistence.** A new transcript display object kind (`bang-command`) in
  the tagged union, anchored by `placementAfterMessageId` at the transcript
  tail when run. Unlike fork-summary objects these are user-authored, so
  deletion by the owner is allowed. Output does not bloat
  `session-metadata.json`: the object stores the command line, exit
  metadata, and a bounded preview; full output lives in a per-session file
  store under the data directory (e.g. `{dataDir}/bang-commands/`), fetched
  on expand. Truncated display states how much was cut and expand is
  lossless — the acli truncation principle applied to our own UI.
- **Timeout.** A generous default wall-clock cap with visible kill notice;
  cancel is always available. Long-running commands (`pnpm test`) are a
  supported case, not an abuse case.

## Output rendering: markdown by default, with honest fallbacks

Output renders through the standard sanitized markdown path (the same
pipeline as assistant text), with a raw/monospace toggle per block. Markdown
is the right default for the human-report class of tools (`gh`, report
scripts, anything that emits prose/tables).

One verified caveat shapes the fallback design: the acli spec mandates
**compact JSONL** for non-TTY callers — `isatty(stdout)==false` is its
workhorse agent-detection signal — and its human upgrade is pretty JSON, not
markdown. YA runs bang commands through a pipe, so a spec-compliant acli tool
will emit JSONL here, not markdown. Therefore:

- Output that parses as JSON/JSONL is auto-fenced (and may be
  pretty-printed) rather than fed to the markdown renderer, where bare
  underscores and brackets would mangle it.
- Output that looks like ANSI/binary is fenced raw.
- Everything else gets the markdown path.

Possible upstream follow-up (in `~/agents`, not here): extend the acli spec
with a "renderable display surface" signal — an env marker or `--format md`
convention — so tools can opt into markdown when the pipe consumer is a
human-facing renderer like this one. Until then, per-command judgment plus
the fallbacks above are the contract; do not assume acli tools emit markdown.

## Tab completion

- **Command token** (first token after `!!`): completion candidates are
  executable names from the server's PATH plus project-root executables,
  served by a session/project-scoped endpoint with a cached scan
  (invalidated lazily; PATH scans are cheap but not per-keystroke). The
  client UI reuses the existing composer suggestion machinery
  (`getLeadingSlashQuery` / slash-suggestion menu in `MessageInput`) with a
  `!!`-prefix query parser alongside the `/` one.
- **Argument tokens:** project-relative path completion.
- **Not assumed:** a per-tool argument-completion protocol. Verified: the
  acli spec currently defines none. If per-tool completion becomes worth it,
  the right move is an acli spec extension (a `--acli-complete` verb or
  completion manifest) that YA then consumes — not YA-side per-tool
  special-casing.

## Block actions

- **Echo to session.** Injects the command + output into the actual session
  as a single ordinary user turn (fenced, provenance-labeled as a
  user-run local command), routed through the normal delivery controls
  (send / steer / queue depending on session state). Always an explicit user
  action — mirroring the `/btw` rule that result injection is never
  automatic. The injected turn is a real turn; the display object remains.
- **Recall to composer.** Drafts a duplicate of the command text into the
  composer for revision. Chosen over in-place editing of the block: history
  records stay immutable, and the composer remains the single editing
  surface. Keyboard path: shell-style history recall in the composer —
  Ctrl+ArrowUp cycles back through this session's prior bang commands
  (most recent first), Ctrl+ArrowDown forward.
- **Re-run.** Convenience for the unchanged command; produces a new block at
  the current tail (no in-place output replacement — the old run stays as
  the record of what was true then).

## Top-level history view

A persistent view of all bang commands + outputs across sessions, filterable
by project and session, ordered by recency — a top-level surface like Inbox.
It reads the same per-session stores; the global listing needs only the
bounded metadata (command, project, session, exit, timestamp, preview), with
output fetched on expand. This is also the natural surface for re-running a
command in a *chosen* project context, and for pruning old entries. Bounded
by construction: metadata is small and enumerable; never render all outputs
eagerly.

## Open questions

- **Escape hatch for literal `!!` text.** A message legitimately starting
  with `!!` (rare) needs an escape; the routing chip already makes the
  misroute visible before send. Candidate: a leading space disables routing.
- **PTY allocation.** Running under a PTY would flip acli tools to their
  pretty-JSON human branch and make TTY-only tools behave, at the cost of
  ANSI-escape handling in output. Default no-PTY; revisit if fenced JSONL
  proves annoying in practice.
- **Bare `!!` recall.** Submitting `!!` alone could re-run the previous bang
  command (the shell pun). Cute, possibly surprising; decide at build time.
- **Single-`!` reservation.** Claude Code's own TUI uses `!` for bash mode.
  YA does not intercept `!`; keep it unclaimed so a future provider-native
  passthrough is not shadowed.
- **Fork/compaction anchor survival.** Display-object anchors are message
  ids; Claude forks remap uuids, so bang blocks likely do not carry into
  forks. Acceptable for v1; note it in the fork UI if users are surprised.
- **Surface scope.** v1 is the session-page composer only. The floating
  new-session composer (has a project, no session) and aside composers could
  gain it later; the history view's "run in project" affordance may cover
  the sessionless case better.
