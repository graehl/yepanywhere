# OpenCode Copilot exposure + provider enhancement plan

> A prioritized, scoped plan with two aims. **Primary:** let YA users run GitHub
> Copilot models through the existing OpenCode backend, with copilot auth handled
> either by YA-mediated `/connect` or by the host's own `opencode auth`
> local-secret store (SSO/OAuth — never a saved password). **Secondary:** make the
> OpenCode provider fully functional. This doc is a discussion/planning surface;
> the per-item contracts in [`opencode-backend.md`](opencode-backend.md) remain
> authoritative for the general fleshout detail.

Topic: opencode-copilot

See also: [`opencode-backend.md`](opencode-backend.md) (the ten general gaps and
rendering coverage contracts), [`provider-refresh.md`](provider-refresh.md)
(OpenCode refresh inputs), [`cost-efficiency.md`](cost-efficiency.md) and
[`security.md`](security.md) (credential/billing boundary),
[`deferred-roadmap.md`](deferred-roadmap.md) §6 (this re-prioritizes that item
around copilot), [`copilot-provider.md`](copilot-provider.md) (the fallback
standalone-copilot option if OpenCode proves inadequate),
[`copilot-oauth-claude.md`](copilot-oauth-claude.md) (the sibling question — can
copilot OAuth *power the first-party Claude harness*? — plus the parked
`CLAUDE_CODE_OAUTH_TOKEN` finding and the OpenCode-vs-first-party-Claude gaps).

## Why this is mostly an exposure/auth problem, not a protocol problem

The data path for copilot already exists. Local evidence on `gra`
(2026-06-21, read-only):

- `opencode 1.17.9` at `~/.opencode/bin/opencode` (the official installer
  location; on PATH here).
- GitHub Copilot is already OAuth-authenticated in opencode:
  `~/.local/share/opencode/auth.json` holds a `github-copilot` entry with
  `type` (oauth) / `access` / `refresh` / `expires`. This confirms copilot is an
  **OAuth/SSO** credential — there is no password to save, matching the user's
  framing.
- `opencode models` lists **18 `github-copilot/*` ids** (e.g.
  `github-copilot/claude-opus-4.8`, `.../gpt-5.5`, `.../gemini-3.1-pro-preview`)
  out of 48 total.
- YA's provider already parses `provider/model` on the first `/`
  (`parseOpenCodeModelSelection`) and POSTs `model: { providerID, modelID }`, so
  `github-copilot/claude-opus-4.8` → `{providerID:"github-copilot",
  modelID:"claude-opus-4.8"}` should route through `opencode serve` **today**.

So the *primary* aim is largely: verify end-to-end, detect/report copilot auth
honestly, make the models discoverable and selectable cleanly, and add a
`/connect`-style auth affordance. The deep protocol/rendering work
([`opencode-backend.md`](opencode-backend.md)) is the *secondary* aim and is
independent of copilot.

**Caveat (added per user):** "the data path exists" is read-from-source
optimism, not a tested guarantee. The OpenCode provider **was never
well-reviewed or tested**, and opencode itself was **substantially upgraded**
since the integration was written (1.17.9 now vs. the 1.15.13 the
[`opencode-backend.md`](opencode-backend.md) coverage tables were sampled
against — two-plus minor versions of SSE/export/CLI drift). So before trusting
either aim, P0 below leads with a real baseline review against the current
binary. Treat the "mostly exposure/auth" claim as applying to *copilot
specifically*; the *general* provider's correctness is genuinely unknown until
reviewed.

## Auth model: two paths, both "no saved password"

Copilot auth is a **GitHub OAuth device flow** (browser + user code). Two ways YA
can satisfy it, not mutually exclusive:

1. **Local-secret (delegate to `opencode auth`) — recommended first.** The token
   lives in opencode's own `~/.local/share/opencode/auth.json`; YA never holds
   it. YA's job is to (a) *detect* whether `github-copilot` is present and
   unexpired, (b) *surface* the `opencode auth login` command so the user can run
   it on the host, mirroring the existing Claude `loginCommand` copy-panel
   pattern in `ProvidersSettings.tsx`, and (c) ensure the spawned `opencode
   serve` inherits the HOME/XDG that lets it read that auth.json. Lowest effort,
   no new secret custody, consistent with how YA already treats Claude login.

2. **YA-mediated `/connect` device flow — stretch.** YA drives the device flow in
   its own UI (shows the verification URL + user code, polls for completion),
   then either lets opencode persist the result or holds the token itself.
   **Open / unverified:** whether `opencode serve` exposes an auth endpoint to
   initiate/complete login programmatically, vs. YA having to drive GitHub's
   device-code endpoints directly with the copilot client id. Do **not** hardcode
   a device-flow mechanism from memory — probe `opencode auth --help` and the
   serve HTTP surface first, and prefer reusing opencode's flow over
   reimplementing GitHub's. This path only earns its complexity if remote
   (phone) users need to authenticate without shell access to the host.

**Saveable username.** Copilot OAuth needs no stored password; a saved value is
at most an *identity label* (the authenticated GitHub login, for display or
future multi-account selection). Recommendation: after auth, *read and show* the
GitHub login (from `opencode auth` output or the token), and treat any
user-entered username as an optional cosmetic label — never as a credential, and
never persisted alongside a password field. Surface this only if multi-account
copilot is a real need; otherwise display-only.

## Exposure gating ("optionally")

The user wants copilot exposed *optionally*. Three candidate gates, in order of
preference:

- **Natural gate (recommended default): expose `github-copilot/*` only when
  copilot is actually authenticated in opencode.** No new setting needed; the
  models simply appear once `opencode auth login` succeeds and disappear when the
  token is absent/expired. This honors "optional" without a toggle and keeps the
  current non-buggy default (opencode already a provider) intact — consistent
  with the YA-local "UI changes preserve non-buggy defaults" rule.
- **Explicit setting** (`opencodeExposeCopilot`, default off) if we want copilot
  hidden even when authed — only worth it if there's a reason to suppress it.
- **ENABLED_PROVIDERS** already gates *opencode as a whole*; copilot is a sub-gate
  within it, so this is the coarse outer control, not the copilot-specific one.

Decision to confirm with the user: natural gate vs. explicit setting. Leaning
natural gate.

## Prioritized plan

Ordering is value-per-effort. **P0r is the gating baseline review** (the
integration was never tested and opencode jumped versions); P0 is a day-scale
"make copilot real and honest"; P1 is the auth UX; P2 is the general fleshout
(large, copilot-independent); P3 is the fallback. P0r feeds the others — its
findings re-scope P2 and may reveal that some P0 items are already broken rather
than merely missing.

### P0r — Baseline review & test against opencode 1.17.9 (gating)

The OpenCode provider has never had a real correctness/integration review, and
the upstream binary moved 1.15.13 → 1.17.9. Do this first; it is cheap relative
to building on an unverified base, and it converts "looks like it works" into
evidence. Scope:

- **P0r.1 Re-probe the upgraded CLI.** Run [`provider-refresh.md`](provider-refresh.md)'s
  OpenCode loop on 1.17.9: `opencode --version`, `opencode models`,
  `opencode serve --help`, `opencode acp --help`, `opencode auth --help`. Diff
  YA-visible shape (model id format, serve routes, SSE event/part types) against
  what the provider assumes. Capture a fresh SSE fixture and `opencode export`
  sample and re-count part/event coverage vs. the
  [`opencode-backend.md`](opencode-backend.md) tables (currently 22/48 sampled
  parts; verify the number still holds).
- **P0r.2 Source read of the whole integration.** Review
  `packages/server/src/sdk/providers/opencode.ts` (live SSE + producer/consumer
  loop, the 100 ms poll/`resolveWaiting` pattern, the POST-body fallback path,
  abort-by-`SIGTERM` semantics, per-session port allocation),
  `packages/server/src/sessions/opencode-reader.ts`,
  `packages/server/src/sessions/normalization.ts`, and
  `packages/shared/src/opencode-schema/`. Name the correctness risks explicitly:
  tool-result `id`↔`tool_use_id` pairing, role filtering of user parts,
  `session.idle` stop condition, SSE-vs-POST-fallback double-emit guard
  (`usedPostBodyFallback`), and the kill-the-server-to-abort model (no graceful
  interrupt). For a deep structural pass, `skills/harsh-review/SKILL.md`.
- **P0r.3 Audit existing tests vs. reality.** Inventory
  `packages/server/test/sdk/providers/opencode.test.ts`,
  `test/sessions/opencode-reader.test.ts`,
  `test/e2e/opencode-permissions.e2e.test.ts`, and the `__mocks__/opencode.ts`
  mock. Determine what is actually exercised vs. mocked-to-pass, and whether any
  test asserts against stale 1.15.x shapes. Identify the smallest set of *real*
  (non-mocked) fixtures that would have caught a regression.
- **P0r.4 Real-model smoke (free + copilot).** Run at least one live session on a
  free/built-in opencode model and one on `github-copilot/*`, asserting visible
  streaming text, a tool round-trip, thinking/reasoning, and a clean
  result/usage tail. Clean up disposable sessions/projects afterward (local
  debug-session hygiene).
- **Output:** a findings list recorded in this topic (or a gitignored
  `tasks/NNN-opencode-review.md` if it spans sessions) that re-prioritizes P0/P2
  and flags anything that regressed across the version jump.

### P0 — Make copilot work and report honestly (small; after/with P0r)

- **P0.1 End-to-end verify (copilot-specific).** Extends P0r.4: on the
  `github-copilot/claude-opus-4.8` smoke, additionally confirm billing routes
  through the copilot subscription rather than an ambient API key (the model id
  names the provider explicitly, so opencode should select copilot auth — but
  P1.3's env scrub is what guarantees it). Record the result here. This is the
  on/off validation the feature-validation rule wants.
- **P0.2 Binary detection.** Add `~/.opencode/bin/opencode` to
  `findOpenCodePath`'s common locations. Today detection only succeeds via the
  PATH `which` fallback; the official installer path is missing from the
  hardcoded list.
- **P0.3 Honest auth status.** `OpenCodeProvider.getAuthStatus()` currently
  returns `installed ⇒ authenticated` ("has free models"). Make it probe real
  copilot auth (read `~/.local/share/opencode/auth.json` for an unexpired
  `github-copilot` entry, or parse `opencode auth list`) and report
  `authenticated`, `expiresAt`, and a `loginCommand` (`opencode auth login`).
  Keep "installed ⇒ usable for free models" as a separate truth from "copilot
  authed".
- **P0.4 Model discovery for authed providers.** `opencode models` lists *all*
  known models, including providers the user can't use. At minimum surface
  copilot models when authed; better, filter/group the 48-entry list by
  authed provider so a user doesn't pick a model that will fail at runtime. See
  P2-adjacent UX note below.

### P1 — Copilot auth UX: `/connect` + credential boundary

- **P1.1 Local-secret affordance (recommended).** In `ProvidersSettings.tsx`,
  render an opencode/copilot auth panel reusing the Claude login-command
  copy-pattern: show status (authed GitHub login + expiry, or "not connected")
  and the `opencode auth login` command. This is the "opencode auth" path.
- **P1.2 `/connect` action.** A YA button labeled to start copilot auth. v1 =
  copy/run the command (cheap, host-shell). v2 (stretch) = YA-mediated device
  flow per the "Auth model" §2 caveats above — only after probing what opencode
  exposes.
- **P1.3 Credential/billing boundary.** Today `opencode serve` is spawned with
  the full `env: { ...process.env }` — unlike Claude/Grok, which scrub ambient
  API keys (see `env-filter.ts`, [`grok.md`](grok.md) § API Key Billing
  Boundary). Ambient `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / etc. could make
  opencode prefer pay-as-you-go API billing over the copilot subscription.
  Decision: add an opencode-spawn env policy that defaults to *not* leaking
  ambient model-provider API keys (so copilot/subscription auth is used), with a
  default-off opt-in to allow API-key billing — mirroring the grok
  `grokBuildUseXaiApiKey` toggle. Caveat: opencode legitimately uses many
  provider keys, so scope the scrub deliberately and document it; this is a
  design decision to confirm, not a silent change.
- **P1.4 Saveable username (optional).** Only if multi-account is wanted: a
  display-only authed-login readout, optional cosmetic label, no password field.

### P2 — General OpenCode fleshout (secondary, large, copilot-independent)

Re-prioritized from [`opencode-backend.md`](opencode-backend.md) § Gaps To Close,
ordered by what most improves a *copilot session's* usability/reviewability:

- **P2.1 Durable reasoning** → map stored/export `reasoning` parts to YA
  `thinking` (with a reload fixture). Copilot Claude/GPT models emit reasoning;
  it's currently dropped on history view. (backend gap #1)
- **P2.2 Tool-name aliases** → map opencode lower-case `bash`/`task`/etc. to YA's
  rich renderers; keep unknown tools explicit. (backend gap #3)
- **P2.3 Permission bridge** → wire `permission.asked` / `GET /permission` /
  `POST /permission/:id/reply` into YA's approval UI. (backend gap #5)
- **P2.4 Remaining backend gaps** → durable event-shape parity, tool-result
  pairing correctness, native command inventory, thinking/effort option mapping,
  graceful interrupt/steer, and the `ses_*` vs YA session-id split. (backend gaps
  #2, #4, #6–#10)
- **P2.5 Model-picker UX** → grouping/sorting the now-large catalog (48 ids),
  provider-prefix grouping, glyphs for `github-copilot/*` (see
  [`provider-model-glyphs.md`](provider-model-glyphs.md)). Belongs with the UI
  glyph topic, not the provider runtime.
- **P2.6 Provider-refresh enactment** → P0r.1 *probes* the 1.17.9 drift; this is
  the follow-up to *enact* any source/doc refresh it surfaces (coverage tables in
  [`opencode-backend.md`](opencode-backend.md), schema in
  `packages/shared/src/opencode-schema/`, fallback constants) under
  [`provider-refresh.md`](provider-refresh.md)'s loop and record the dated
  result there.

### P3 — Fallback: standalone Copilot provider

If copilot via opencode proves inferior (quality, control surface, or auth
friction), a separate first-class copilot provider over the Copilot CLI/TUI or a
Copilot API is the escape hatch. Scoped separately in
[`copilot-provider.md`](copilot-provider.md) so it doesn't bloat this plan.

Two sibling architectures, both **sanctioned** (verified against GitHub's Copilot
SDK docs and Anthropic's LLM-gateway docs — not ToS workarounds):

- **B — Claude TUI fronting a Copilot-SDK gateway**
  ([`copilot-oauth-claude.md`](copilot-oauth-claude.md)): keeps the first-party
  Claude Code harness while spending Copilot budget, via a YA-built
  Anthropic-compatible gateway on the official Copilot SDK. Best quality
  (recovers Claude Code's system prompt/hooks/tools); only loses Anthropic prompt
  caching. That topic also records the `CLAUDE_CODE_OAUTH_TOKEN` headless-auth
  provision and the OpenCode-vs-first-party-Claude gaps.
- **C — direct YA `copilot` provider** on the Copilot SDK/CLI
  ([`copilot-provider.md`](copilot-provider.md)): YA is the harness; a first-class
  Copilot provider, same allowed status, an alternative to depending on opencode.

## Open decisions (for discussion)

1. **Exposure gate**: natural (only when authed) vs. explicit setting. Leaning
   natural.
2. **`/connect` ambition**: copy-the-command v1 only, or invest in a YA-mediated
   device flow for shell-less remote users?
3. **Env/billing scrub for opencode spawn**: adopt the grok-style default-off
   API-key opt-in, or leave opencode inheriting full env? (Cost-boundary risk vs.
   opencode's legitimate multi-provider key use.)
4. **Saveable username**: skip (display-only) unless multi-account copilot is a
   stated goal.

<!-- epistemic status: local read-only inspection on `gra` 2026-06-21 (opencode
1.17.9, copilot OAuth present in auth.json, `opencode models` catalog) plus
provider source reading; YA-mediated device-flow mechanics are explicitly
unverified and flagged. -->
</content>
</invoke>
