# Forged Transcript Handoff (proposal)

> Proposed experiment: hand context to a successor session by writing a
> filtered provider transcript — real turns kept, noise dropped, long
> tool output condensed — and resuming it, so inherited context reads as
> natural conversation turns instead of one giant quoted handoff
> message. Cost and distraction reduction, not bypass.

Topic: forged-transcript-handoff

Status: proposal only (user-requested experiment, not yet scheduled).
Do not implement ahead of the validation gates below.

Related topics: [session-context-actions](session-context-actions.md),
[provider-context-economics](provider-context-economics.md),
[compact-and-handoff](compact-and-handoff.md),
[resume-compaction](resume-compaction.md)

## Intent

The scripted template handoff already works: a new session whose first
user message quotes the source transcript. Its weaknesses are
representational, not informational — the successor sees one giant user
turn, so (a) turn structure is lost (the model treats quoted assistant
text differently from its own prior turns), (b) everything is inside
one user message, inviting the model to respond to the quote rather
than inhabit it, and (c) we pay for boilerplate framing.

The forged variant writes a *provider-format transcript file* (Claude
jsonl; Codex rollout) containing a filtered projection of the source
session — selected real user/assistant turns verbatim, irrelevant
detours dropped, oversized tool results replaced by short stand-ins —
and resumes it as an ordinary session. The intent is exactly what the
template handoff and provider compaction already attempt — cheaper,
less distracting inherited context — with a more natural
representation. Nothing about it bypasses permissions, safety, or
billing; it is a context-construction technique.

## Integrity constraints (what "forged" must not mean)

- Kept turns are verbatim copies of real turns. Edited or condensed
  content must be marked in-band (e.g. a bracketed
  `[condensed by YA from N tool results]` stand-in), never presented as
  something the model previously said when it didn't. A successor that
  trusts a fabricated "I verified X" turn will build on a false memory;
  that is the failure mode to design against.
- Wholly synthetic turns are limited to connective tissue (a system or
  user note explaining the projection), not invented agent work.
- The forged file must end on a user/tool turn — current Anthropic
  models reject a trailing assistant prefill — and satisfy the
  provider's schema (uuid/parentUuid chain for Claude; our
  `packages/shared` Zod schemas track that shape and its drift).

## Mechanism sketch (Claude first)

1. Read source session, build the active branch (existing DAG reader).
2. Apply a filter: keep-list of turn ranges, tool-result size caps,
   optional model-written one-line summaries for dropped spans.
3. Emit a new jsonl with fresh session id, remapped uuids, valid parent
   chain (the SDK's own `forkSession` is the reference implementation
   for the copy/remap step; the delta is the filter).
4. Resume the new id through the normal Supervisor path; YA session
   metadata records provenance (`forgedFrom: <source id>`).

Codex variant: same shape over rollout files; lower confidence in
schema stability, and no reference fork implementation. ACP providers
and opencode: not possible (no transcript file surface).

## Why it can lose (record before A/B)

- Cache economics: a forged prefix is new bytes — always a full-price
  first turn, while fork-slice can inherit a warm cache
  ([provider-context-economics](provider-context-economics.md)). The
  win must come from being *smaller* and *better-shaped*, not cheaper
  per token.
- Schema drift: provider-versioned internals; a silent format change
  breaks resume or, worse, partially loads.
- Provider tooling may treat the transcript file as its own artifact
  (compaction metadata, file-history snapshots, leaf pointers); a
  forged file missing those may behave subtly differently.

## Validation gates

1. Round-trip gate: an *unfiltered* forged copy (pure re-emit) of a
   real session resumes and continues correctly — proves the writer
   before any filtering is trusted.
2. Filter gate: filtered forge of the same session; successor answers
   continuation probes as well as full resume on a small fixed probe
   set.
3. A/B vs template handoff: same source sessions, same continuation
   prompt; compare token cost and a blinded usefulness judgment.
4. Drift tripwire: validate-jsonl over the forged output + a pinned
   SDK-version check before each use; refuse to forge on unknown
   schema versions rather than emit best-effort.
