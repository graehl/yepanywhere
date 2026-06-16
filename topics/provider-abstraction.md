# Provider abstraction seam

When provider- or model-specific behavior belongs on the `AgentProvider`
interface instead of as inline `if (provider === "claude")` / `if (model
matches …)` branches in generic callers (routes, the Supervisor, shared
helpers).

See also: [`provider-state-machine.md`](provider-state-machine.md),
[`provider-context-economics.md`](provider-context-economics.md),
[`provider-refresh.md`](provider-refresh.md). Global aesthetic: the
"shared-facility contract" rule and agent-design's "promote to a dedicated
surface when you need to gate/render/audit".

## Status: NOT yet systematically applied

This is a forward-looking guideline, adopted incrementally. Existing
provider/model conditionals have **not** all been migrated — e.g. the
codex-spark targeted auto-compact (`tryQueueTargetedAutoCompact`), the
claude-only preemptive-compaction trigger (`maybeCompactBeforeDelivery`), and
the alias↔resolved model-identity canonicalization still live as inline
branches. `contextWindowFor` (below) is the first surface to adopt this seam.
Don't treat the presence of remaining inline conditionals as a bug to sweep;
migrate them when they next hit a trigger below.

### Candidate next surfaces

- **Requested ↔ reported model-name mapping.** The UI keys per-model settings
  by the alias the user picked ("opus"); a running session reports the resolved
  id ("claude-opus-4-8"). The provider is the one component that knows its own
  resolution, so a `provider.canonicalModelKey(model)` (or
  `aliasForReportedModel`) belongs there rather than as family-regex
  canonicalization scattered across the route, settings, and client. Pending a
  parked design decision on which identity is canonical (alias vs resolved id —
  the latter lets distinct aliases that resolve to the same model *share*
  settings, but "default" is subscription-dependent and resolvable only at
  runtime).
- **Preemptive-compaction policy.** The claude-only `maybeCompactBeforeDelivery`
  and the codex-spark-only `tryQueueTargetedAutoCompact` are two inline
  per-provider blocks that a single `provider.compactionPolicy` (default: none)
  would own.

## When to promote to a provider surface

Promote an inline provider/model conditional to an **optional**
`AgentProvider` method (default: no-op / identity / `undefined`) when any of:

1. **It recurs.** The same provider/model conditional appears in 2+ places.
   (The Claude always-1M family regex had spread to ~4 call sites — that was
   the tell that drove `contextWindowFor`.)
2. **A generic caller has to know provider internals.** A route should not
   "know" that Claude opus runs at 1M, or that codex-spark compacts at 85%.
3. **Adding a new provider would require editing the generic code** rather
   than just implementing the interface.

## When NOT to

A single, localized, one-off conditional stays inline. Don't abstract on first
sight — indirection has its own cost. The **default-does-nothing** property is
exactly what makes the surface cheap to add *later*, so there is no penalty for
waiting until a trigger above actually fires.

## The default-no-op contract (low blast radius)

Make the method optional with a default that preserves current behavior:

- Window/identity resolvers: return `undefined` to defer to the generic
  heuristic, so non-implementing providers are unaffected.
- Policy hooks (e.g. preemptive compaction): default to "no policy", so the
  generic path runs exactly as before.

A new optional method touches only the providers that opt in; every other
provider and caller is unchanged. That is the property that lets this be
adopted one surface at a time.

## First instance: `contextWindowFor`

`AgentProvider.contextWindowFor?(model): number | undefined` — the effective
context window this provider runs `model` at, or `undefined` to defer to
`getModelContextWindow`. `ModelInfoService.getContextWindow` consults it first
(before its alias-keyed cache and the shared heuristic), so the Claude
provider owns "opus is always-1M, sonnet is not" instead of leaking that into
`resolveCompactWindow`, the settings route, and the client. Sonnet's 1M needs
paid usage credits, so only opus is overridden; everything else defers.
