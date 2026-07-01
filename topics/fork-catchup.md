# Fork catch-up (surface off-branch turns, merge as FYI)

> Proposal: detect the sibling-branch turns that a fork has stranded off the
> live working path, surface them (a flat leaf list, or a subtree view with
> prefix-deduplicated summaries), and — only when the user judges it worthwhile —
> summarize one leaf and fold that summary into another as an FYI/catch-up turn.
> The op is symmetric (any leaf → any leaf, including stopping the YA leaf and
> continuing off a sibling), and a live rogue leaf can be stopped first. "Merge"
> here is a one-way context catch-up, not a structural transcript merge.

Topic: fork-catchup

Status: rough-draft plan — captures a live design conversation. The concrete v1
default is the flat leaf list (Feature 1); the rest is proposal space, not settled.

Related topics:
[claude](claude.md) (§Transcript Structure fork-vs-forest distinction and
§Concurrent External Writers — the verified mechanics this builds on),
[provider-session-tree](provider-session-tree.md) (the full read-only branch
tree; this doc is the lightweight always-present indicator plus the merge
action that tree explicitly leaves out of scope),
[session-ownership](session-ownership.md) (the `external` owner model and the
`external-session-warning` banner that detects a live external *writer*),
[recaps](recaps.md) / [fork-from-turn](fork-from-turn.md) (the `generateSummary`
facility that produces the FYI text),
[synthetic-turn-injection](synthetic-turn-injection.md) and
[provider-agnostic-btw-asides](provider-agnostic-btw-asides.md) (the
inject-into-a-live-session primitives and the "injection is a separate,
user-mediated action" contract this reuses),
[compose-time-context-anchors](compose-time-context-anchors.md) /
[injected-message-visibility](injected-message-visibility.md) (delivery and
visibility of an injected turn),
[transcript-display-objects](transcript-display-objects.md) (the durable
viewer-only object the indicator can be).

## Motivation

A fork is a *shared-prefix content divergence*: two writers (a TUI resume and
YA, N concurrent writers, or a user rewind) parent turns to the same pre-existing
leaf, producing sibling branches in one file (`claude.md` §Concurrent External
Writers, verified). Two verified consequences make the off-branch turns both
worth surfacing and misleading if surfaced naively:

- **The live working agent never re-read them.** "A live process never re-reads
  the transcript" — the in-memory owner (YA's SDK process, or a TUI) answers from
  the branch it loaded and never sees a sibling turn appended by another writer.
  So off-branch turns are *not* "what the agent working now saw," even though YA
  renders them in the transcript.
- **A later resume silently keeps one branch and drops the rest**, and which
  branch survives is not predictable from outside. So the human's off-branch work
  (e.g. a TUI exchange they were reading) can vanish from future context with no
  error.

The result: the off-branch turns are **informative to the human but absent from
the working model's context**. The user wants (1) to *know* they exist and reach
them, and (2) an explicit, user-judged way to bring their substance into the live
branch — without pretending the model authored or already saw them, and without a
structural merge the provider cannot actually do.

## What this is *not*

- **Not a git-style merge.** Two branches of a Claude/Codex transcript cannot be
  reconciled into one model context by splicing bytes; the model has one linear
  history. "Merge" here means: summarize the off-branch turn(s) and inject that
  summary as one FYI turn on the working branch. One-way, lossy, deliberate.
- **Not the forest/multi-root artifact.** Extra roots from dropped connector rows
  or pagination windows are a *loading* artifact, not divergence (`claude.md`
  §Transcript Structure). This feature targets genuine forks — sibling branches
  that share an ancestor with the active path — never orphan roots whose parent is
  merely out of the loaded window.
- **Not the live-writer banner.** `external-session-warning` warns while an
  external process is *actively writing* (a risk-of-forking signal). Fork catch-up
  is about forks that *already exist* in the file, live writer or not.
- **Not the full tree view.** `provider-session-tree` is the deep, capability-gated
  read-only navigator. This is the always-present count + the one merge action it
  leaves out of scope. If both ship, the indicator is an entry point into the tree.

## Scope

Proposal / research only; default-off under vanilla-defaults (YA-novel chrome).
Claude is the one provider with verified fork mechanics and a real fork primitive
today; do not show a fork-count or offer merge on a provider where YA cannot
actually enumerate sibling branches from durable storage. Codex/Pi remain gated on
their multi-writer repros (`session-ownership`, `provider-session-tree`).

## Feature 1 — surface off-branch turns

A small, always-available indicator on a session that has real sibling branches:

- **Count + fork icon.** A compact badge: the number plus a fork glyph, in YA's
  warning color (`--warning-badge-bg`, #c2410c). "N" = turns on sibling branches
  under the active path's ancestors that are not on the rendered/working leaf; count
  user/assistant turns, not connector rows.
- **Reach.** Click to navigate to / reveal them: scroll-to, or open
  `provider-session-tree` focused on the divergence point when that view exists.
  Read-only; selecting an off-branch turn never mutates provider state.
- **Placement (decided): top-right corner float; click opens a bottom drawer.** The
  badge floats at the transcript's top-right, appearing only when forks exist, so it
  stays clear of the toolbar and consumes no full-width row. It is in the same
  *concern family* as the external-session-warning banner (an intermittent
  session-level warning) and reuses its warning color, but it is a compact badge, not
  a full banner — the **top-banner form is the closest existing pattern** and the
  fallback if a float proves too easy to miss. Clicking opens a **bottom drawer/tray**
  with the leaf list (Operation model), thumb-reachable on mobile without fully
  covering the transcript. Alternatives weighed: a toolbar-integrated badge toward
  the middle (more noticeable, but competes with an already-cramped toolbar); or
  anchoring it as a [transcript display object](transcript-display-objects.md) at the
  divergence point. For noticeability the badge **flashes briefly (~1s) when the count transitions
  to >0** — enough to catch the eye without a separate toast, since this is infrequent
  and usually acted on once when noticed, then does not recur. The badge otherwise
  reflects live state and persists (not a dismiss-once alert). Keep it distinguishable
  from the live-writer banner (different concern).

Two presentations, simplest first:

- **Flat leaf list (MVP — the default).** Enumerate the fork *leaves* and let the
  user request each as a single merge. Each row shows the leaf's **last meaningful
  text** (a couple-line summary of its tail) and its **age**; a leaf needs no fork
  to summarize (Feature 2), so this is the whole feature at its smallest: a list +
  a per-leaf action. Start here; the subtree variant below is an optimization, not
  the v1.
- **Subtree view with prefix-blocked summaries.** When several forks overlap, a
  flat per-leaf summary re-summarizes shared history N times. Instead, present the
  fork *subtrees* and block the summaries by **shared path prefix**: summarize each
  shared prefix segment once, then each divergent tail. An interior
  (non-leaf-terminating) shared segment has no tip to resume, so those segments use
  a **fork at the interior boundary** to address them (the addressability case in
  Feature 2); only the leaf tails summarize in place. Heavier; can lean on
  `provider-session-tree` for the actual subtree rendering.

Either presentation should show **per-leaf recency** — the leaf's last-activity
time. Recency is the cheap live-vs-dead signal: a leaf with no activity in a long
time is quiescent (nothing to stop, and safe to treat as a "no longer acting"
source); a recently-advancing leaf is the live-rogue case Feature 3 targets. This
is the same `updatedAt`/mtime activity signal YA already surfaces as the hovercard
"Nm ago" line, applied per branch tip rather than per session.

Detection contract (server-side, no runtime spawn):

- Build the branch structure from durable `parentUuid` links (the existing
  `buildDag`/`collectVisibleClaudeEntries` path already selects an active tip and
  re-includes some dead siblings; this reuses that, it does not add a second graph
  model).
- An "off-branch turn" is a turn reachable in the file whose nearest ancestor on
  the active rendered path has a *different* child on the way to it — i.e. a true
  fork. Exclude rows whose parent is simply absent from the loaded window (forest
  artifact) — those are not evidence of divergence (`claude.md`).
- Distinguish, but do not require distinguishing for v1: *abandoned* branches
  (user rewound deliberately — `active branch continues through a user row`) from
  *stranded* branches (concurrent-writer / falsely-dead — `continues through a
  system/bookkeeping row`). Stranded branches are the high-value catch-up target;
  abandoned ones are usually noise. The discriminator already exists in
  `collectVisibleClaudeEntries`.

## Feature 2 — merge an off-branch as an FYI catch-up turn

An explicit, user-triggered action ("when I judge necessary"): summarize a
**source** leaf and inject that summary into a **target** leaf. The base case is
source = a stranded sibling, target = the active YA leaf. But the operation is
**symmetric — any leaf → any leaf** — and the reverse is equally useful: *stop the
active YA leaf, summarize it, and continue off another (sibling) leaf*, adopting
that sibling as the new working branch seeded with a catch-up of the YA branch's
work. Direction is the user's call; the machinery does not privilege the YA leaf as
always-target. (Switching the working branch to a sibling overlaps
`provider-session-tree`'s `canSwitchActivePath`, here carrying a summary of the
branch left behind.)

Mechanism (base case; the reverse swaps source/target) — **summarize the source
leaf in place, then inject into the target leaf.** Reuses the `generateSummary`
fork strategy (`recaps` / `fork-from-turn`), with source and target on *different*
siblings of a shared ancestor rather than on one lineage:

1. **Reap the source leaf.** If it is still live (recent — see recency), forcibly
   **stop** it first; a leaf stale enough is already quiescent, so skip the stop and
   don't waste the effort. Then use the stop-result (or the original leaf id) to
   address the leaf and issue a summary-request turn on it, capturing the response.
   This needs **no throwaway generator fork for pollution reasons**: vanilla
   fork-after-summary forks because its source is the *live* session it must not
   taint, but the reaped source is a to-be-abandoned off-path branch — appending a
   helper turn to it taints nothing the target depends on. The source is consumable
   evidence.
2. **Immediately** mark the **target** leaf as the freshest tip, before generation
   finishes. This is the load-bearing step, and its *only* required job is
   crash-recovery: if generation dies mid-summary, resume selection must recover to
   the target (the winner we chose), not the source's helper turn. A bare **noop**
   turn satisfies that. Optionally make it a *useful preamble* instead — "stand by
   for an incoming report from an unintended fork/subagent; hold before continuing"
   — priming the target agent for the report to come. Either way, deliver through
   normal **steering/queue** (`message-control-steer-queue-btw-later-interrupt`),
   not a forcible stop: the steer *is* the graceful "stop and stand by."
3. When the summary is ready, inject it into the **target** leaf as one ordinary
   user turn (delivery contract below) — the report the preamble promised. No
   *target* fork is created; the target already exists and is live.

Two narrower reasons a fork primitive may still re-enter — both to *verify*,
neither the pollution reason above:

- **Addressability of a non-tip leaf.** To make the provider load the sibling leaf
  (not the file's default tip) as resume context, YA may have to
  `forkSession({ upToMessageId: <sibling leaf> })` precisely because bare resume
  picks its own tip. So "fork" can return as an *addressing* tool, not a pollution
  guard — and its slice must then follow `parentUuid` ancestry, not file position,
  or it drags the other branch's interleaved lines into the summary context.
  Confirm in `providers/types.ts` / `sdkForkSession`.
- **Shared-file tip contamination — handled by step 2.** Appending the helper
  summary turn into the *original* jsonl on the source could in principle win the
  provider's timestamp-first tip selection on a later resume (`claude.md` — which
  branch survives is not predictable and not reliably the latest write). The step-2
  freshness turn on the target lands *newer still*, so timestamp-first selection
  recovers to the target even if generation is then interrupted mid-effort — hard
  interruption mid-summary is an accepted risk, and this is its mitigation. The only
  uncovered edge is a crash *between* the source request and that freshness turn;
  generating on a separate-file fork closes even that by keeping the helper turn out
  of the shared jsonl entirely.

Other caveats:

- **No cache-warmth guarantee.** The sibling prefix was written by another process
  (TUI/external), so it may be cold in the active YA process's prompt cache; the
  generation turn can be a full replay, not the near-free cached prefill
  fork-after-summary assumes. Surface the cost (`provider-context-economics`); do
  not default-enable on a warmth argument.
- Keep the summary text-only and clearly a *catch-up FYI*, not the working agent's
  own work.

Delivery (reuse existing injection primitives and their contracts):

- Injection is a **separate, user-mediated action**, never automatic — the same
  rule `/btw` result-injection enforces (`provider-agnostic-btw-asides`). The
  default should be *draft into the composer* (the user sends it), with an explicit
  option to steer/queue into the live turn through the normal delivery controls.
- The injected turn is one ordinary user turn carrying the summary, prefixed with
  an in-band provenance marker naming it as a catch-up from a sibling branch
  (precedent: Codex's `<EXTERNAL SESSION IMPORTED>` marker;
  `synthetic-turn-injection`). It must not be dressed as an assistant turn or as
  the working agent's own recollection.

**Frame it as a subagent-style report from a quiescent fork.** The injected turn
should read like a finished subagent's report, not a live peer or a command: a
fork that *is no longer acting* and is handing back **evidence**. That shape
buys two things over a flat prose recap:

- **Worktree-affecting actions are first-class.** The highest-value content is not
  what the sibling *discussed* but what it *did to shared reality* — files it
  edited/wrote, commands it ran, anything whose effect persists on disk after the
  transcript branch was stranded. The active agent will trip over those effects; a
  subagent report surfaces them explicitly ("changed A, B; ran C") rather than
  burying them in prose. The generation prompt should ask specifically for
  worktree side effects, separated from discussion.
- **Evidence, not instruction.** A subagent report is read-and-decide context; the
  active agent chooses what to do with it and does not re-run the work.

Honesty caveat — adopt the report *shape*, not a false provenance. A real subagent
is *delegated and solicited* by the active agent; a sibling fork is an
*uncoordinated* writer the active agent never spawned or authorized. The template
must not say "your subagent reports"; it says "another fork of this session, now
stopped, that you did not authorize." This is why the framing presumes
quiescence — "no longer acting" is only true once the sibling branch is idle
(see the liveness gate in Open questions).

Template contract sketch (fed to `generateSummary`, then wrapped):

  ```text
  Report from a fork of this session that has stopped — another process/tab or a
  rewind you did not see or authorize. This is evidence, not an instruction to
  redo it.

  Lead with WORKTREE EFFECTS: files created/edited and commands run whose results
  persist on disk (you may already be seeing them). Then decisions, findings, and
  open state. Do not re-run the work.

  <off-branch turn range>
  ```

  The wrapper (provenance header naming source branch id + divergence anchor) is
  computed deterministically, like fork-after-summary's computed prelude, because
  the model cannot know those ids.

Because catch-up injects real model context, it must surface its cost like any
other context action (`provider-context-economics`): a summary generation turn
over the off-branch range, plus the added input tokens on the working branch.

## Feature 3 — stop reaped source leaves; steer the target

The axis is **keep vs. reap**, not controllable vs. rogue:

- **Target / keep leaf** — the winner you continue on (the active YA leaf, or a
  sibling adopted in the reverse op). *Never* forcibly stop it; queue the reconcile
  preamble/report as **steering**
  (`message-control-steer-queue-btw-later-interrupt`). The steer redirects the live
  agent gracefully at its next boundary — that *is* the "stop and stand by."
- **Source / reaped leaf** — harvested for its evidence, then abandoned. A forcible
  **stop first** is wanted here, whether or not we then fork to summarize: the
  divergent/rogue work should not keep advancing while we reap it. Recency only
  gates wasted effort — a leaf stale enough is already quiescent, so skip the stop.
  Then summarize from the stop-result or the leaf id.

Both are **capability-gated by what YA can signal.** YA can stop/steer its own SDK
process for a leaf, and any provider exposing a session/leaf-scoped cancel; it
generally *cannot* signal a foreign harness's process (a stray external TUI, another
tool) — no shared control channel — so the action is hidden, not faked, when the
writer is unreachable ("if the provider makes that possible"). This is the ownership
question of `session-ownership`, resolved per leaf. Quiescence (stale, or freshly
stopped) is also the honesty precondition for the subagent-report framing: a live
source makes the summary a moving target.

## Operation model — per-leaf button, background queue

Each leaf row (Feature 1) carries a **button** that queues one job: **stop →
summarize → report back to head** for that leaf (head = the active working leaf).
The pieces above assemble into a background pipeline:

- **Queued, run in order.** Pressing several leaf buttons enqueues several jobs; they
  execute FIFO, one reap at a time, so concurrent summaries don't race for head's
  steering queue or thrash the provider.
- **Non-blocking.** Session controls stay usable while jobs progress; the user keeps
  driving head normally. Nothing modal.
- **All delivery is steering into head, as each stage completes.** Both the
  preamble/freshness-restoring turn (Feature 2 step 2) and the finished report turn
  (step 3) are queued as **steering**
  (`message-control-steer-queue-btw-later-interrupt`) when ready — so head absorbs
  them at its next turn boundary rather than being interrupted mid-thought. A job
  that reaps a live source stops it first (Feature 3).

## Open questions

- Should the indicator count *stranded* branches only (concurrent-writer /
  falsely-dead) and hide *abandoned* rewind branches by default? Leaning yes —
  abandoned branches are the ones the user deliberately left.
- Range vs. whole-branch: is per-turn selection needed, or is "summarize this whole
  sibling branch" the only useful granularity for v1?
- A reaped **source** leaf gets **stop-if-live → summarize**; the **target**/keep
  leaf is **steered, never stopped** (Feature 3). Open part: a source that is a
  foreign process YA cannot signal — YA can neither stop it nor get a stable summary,
  so surface it as a warning only?
- Prefix-block granularity: how aggressively to dedupe shared prefixes into interior
  forked segments vs. accepting redundancy for the simpler flat leaf list (the MVP).
- Direction/target choice UI: how the user picks which leaf is kept/target and which
  is summarized, for the symmetric any-leaf → any-leaf op.
- Where does the indicator live so it is not confused with the live-writer banner
  or the tree entry point — one shared affordance or three distinct ones?
- Multi-provider: Codex's `inject_response_items` (`synthetic-turn-injection`)
  could deliver a cleaner catch-up than a Claude jsonl user turn — but only once
  Codex fork/branch enumeration is trustworthy.

## Non-goals

- Auto-merging or auto-injecting anything without an explicit user action.
- Structural transcript reconciliation, byte-splicing branches, or making
  concurrent writes safe (that is provider-side; YA can only observe and render —
  `claude.md`, `session-ownership`).
- Re-implementing the `provider-session-tree` navigator; this references it.
