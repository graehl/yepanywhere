# Provider Session Tree

> Provider session tree is a proposed, capability-gated YA view for provider
> transcripts whose durable records carry a simple parent-link chain, exposing
> branches in a sidebar without inventing fork semantics for providers that do
> not store them.

Topic: provider-session-tree

Related topics: [session-context-actions](session-context-actions.md),
[provider-context-economics](provider-context-economics.md),
[session-ownership](session-ownership.md),
[pi-provider](pi-provider.md),
[fork-from-turn](fork-from-turn.md),
[provider-fork-support](provider-fork-support.md) (the write side:
`canForkAtNode` ⇔ a provider implementing `forkSession`),
[vanilla-defaults](vanilla-defaults.md)

## Motivation

pi already has a native `/tree` command: it renders the session's
`id`/`parentId` history as an outline, marks the active path, and lets the user
switch the active linear context to a chosen node. That matches a broader YA
need: when a provider's durable transcript already contains parent links,
branches should be visible and navigable instead of silently collapsed to one
linear replay.

The immediate Pi symptom is a useful falsifier. After a YA server restart, a
Pi TUI can resume the same session file while YA later resumes it through
`pi --mode rpc --session <id>`. Those are two Pi runtimes with independent
in-memory leaves writing one append-only JSONL tree. The JSONL is not byte
corrupt, but later turns can become sibling branches. A sidebar tree would make
that divergence visible; it would not by itself make concurrent writing safe.

## Scope

This is proposal/research only. It should not be implemented as a default UI
change until the capability model and provider-specific read contracts are
pinned.

In scope:

- providers whose durable records expose one parent pointer per transcript
  entry, enough to build a rooted tree or DAG projection;
- a YA sidebar tree view that shows branches, the active/rendered path, stale
  external activity, and branch metadata;
- read-only navigation in YA's loaded transcript window;
- provider-native branch switching only where the provider exposes a safe
  primitive.

Out of scope for the first pass:

- emulating tree support by replaying or fabricating transcript files for a
  provider without native parent links;
- resolving concurrent writers automatically;
- making the tree the default session navigation surface;
- hiding or suppressing the existing external-writer warning.

## Provider capability model

Add capability fields only after a provider audit proves the backing data:

```ts
sessionTree?: {
  canReadTree: boolean;
  canSwitchActivePath: boolean;
  canForkAtNode: boolean;
  parentLink: "parentId" | "parentUuid" | "provider-specific";
}
```

`canReadTree` means YA can enumerate all known nodes and parent links from
durable storage without spawning a provider runtime. `canSwitchActivePath`
means YA can ask the provider to make a node the active linear context for
future turns. `canForkAtNode` is the existing prefix-fork idea, but anchored to
tree nodes rather than only rendered user turns.

Important distinction: **readable tree != writable tree**. YA may safely show a
tree for a provider before it can switch or fork from that tree.

## Provider notes

### pi

Pi is the motivating provider. Its v3 JSONL format stores top-level `id` and
`parentId` on every entry. `SessionManager` rebuilds `leafId` from the last
entry at startup; appending advances the in-memory leaf; `buildSessionContext`
walks the active leaf to root. The TUI `/tree` view displays the full tree and
`navigateTree` can move the active linear context to a chosen node, optionally
summarizing/restoring branch state.

YA today reads only the active-leaf path: `PiSessionReader` takes the last
appended node, walks `parentId` to root, and renders that path. A tree-capable
reader would keep the same normalized active path for the transcript while also
returning a sidecar tree:

- all nodes, parent ids, role/type, timestamp, label/name if present;
- active leaf id as interpreted from the file;
- rendered-path ids for the current YA transcript;
- branch summaries / compaction summaries when present.

Pi needs an upstream/fork-side improvement for external fork awareness. The TUI
currently treats its runtime's in-memory leaf as the live truth after startup;
another Pi instance or YA RPC process can append siblings externally, and the
TUI will not necessarily notice that a fork happened outside its process. A
serious fix likely requires Pi to scan or tail the central JSONL, detect when
the file's last leaf no longer descends from the runtime leaf, and surface that
as an external branch rather than silently continuing. Pi does not appear to
maintain a separate global turn-history index that would make this cheap; the
change is substantial and belongs in the `graehl/pi` fork first.

### Claude

Claude JSONL rows carry `parentUuid`, and prior multi-writer repros show
siblings can form when multiple processes resume the same session. YA already
uses a DAG helper for loaded Claude messages, but user-facing tree navigation is
not the same as rendering a repaired active path. Audit before exposing:

- whether every displayed row has a stable user-meaningful node id;
- how SDK `forkSession({ upToMessageId })`, `resumeSessionAt`, and CLI
  `--fork-session` map onto a tree node;
- whether abandoned/error bookkeeping rows should appear in the tree or only
  as diagnostics.

Claude may support `canReadTree` and `canForkAtNode` earlier than
`canSwitchActivePath`; switching the active path in the same session is not a
known first-class operation.

### Codex

Current YA docs treat Codex rollout files as linear, with multi-writer behavior
still open. Do not advertise tree support until the Codex multi-writer repro in
[session-ownership](session-ownership.md) is resolved. If Codex creates a new
rollout per resume, the right UI may be a related-rollouts graph, not a parent
tree.

### OpenCode, Gemini, Grok

No tree support should be assumed. OpenCode's modern durable source is SQLite;
Gemini/Grok ACP surfaces are provider-owned sessions. A future audit may find
parent links, but the first tree proposal should not block on them.

## UI proposal

Add a session-level **Tree** sidebar mode for capable sessions. This should be
configurable/default-off under [vanilla-defaults](vanilla-defaults.md), because
it is YA-novel UI chrome even when the backing provider has a native tree.

Desktop layout options:

- replace the normal session-list sidebar while Tree mode is active;
- add a second-level sidebar between the session list and transcript;
- expose the tree as a slide-over panel from the session toolbar.

The first implementation should prefer a second-level/sidebar mode when width
allows and a slide-over on mobile. Replacing the default sidebar is simpler but
can strand cross-session navigation; a second-level tree keeps project/session
navigation and branch navigation distinct.

Rows should be compact outline entries, not transcript cards:

- role/type icon or short label;
- first line / command summary / branch label;
- active-path marker;
- external-branch marker when a branch appeared from a non-YA writer;
- optional counts for hidden tool-only descendants.

Selecting a node has two tiers:

- read-only selection scrolls or filters the transcript to that node's path;
- an explicit action menu offers provider-native **Switch here**, **Fork here**,
  or **Copy path** only when the capability exists.

Do not make a normal click mutate provider state. Switching the provider's
active path is a session-changing action and should be deliberate.

## Server contract

Expose a provider-neutral tree endpoint after the provider readers can supply
it:

```text
GET /api/projects/:projectId/sessions/:sessionId/tree
```

Response sketch:

```ts
{
  provider: ProviderName;
  activeLeafId: string | null;
  renderedPathIds: string[];
  nodes: Array<{
    id: string;
    parentId: string | null;
    role?: "user" | "assistant" | "tool" | "system";
    kind: string;
    timestamp?: string;
    summary: string;
    label?: string;
    external?: boolean;
  }>;
  capabilities: {
    canSwitchActivePath: boolean;
    canForkAtNode: boolean;
  };
}
```

Tree reads should be cacheable by the same file stamp as session reads:
mtime/size for JSONL providers, provider-specific logical stamps for database
providers. The tree endpoint must not spawn a provider runtime just to inspect
durable history.

## Ownership and safety

Tree visibility complements [session-ownership](session-ownership.md); it does
not replace it. If another process is writing, the amber warning still matters
because a second writer can create a branch after the user has looked at the
tree. The tree can explain the result after the fact, but it cannot make
concurrent appends safe.

When a session is `owner === "external"`, YA should keep send controls
guarded as they are today and may add tree-specific copy such as "new turns may
create another branch." That copy should be shared with the external-writer
risk explanation rather than invented per provider.

## Open questions

- Should the first YA tree be Pi-only behind an internal flag, or should the
  provider-neutral endpoint land first with only Pi implementing it?
- What is the minimum branch summary that helps on mobile without expanding a
  transcript row?
- Should branch labels be YA metadata, provider-native labels, or both?
- How should tree selection interact with existing "Show from" scrollback trim?
- Can Pi expose a cheap live notification when an external writer appends a
  sibling branch, or must YA rely on file watching and reload?
