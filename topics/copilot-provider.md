# GitHub Copilot as a YA backend via the official Copilot SDK

> GitHub ships an **official Copilot SDK** for embedding Copilot in third-party
> apps/services using each user's own subscription. That makes "use my Copilot
> entitlement (including Claude/GPT/Opus models) from YA" a *sanctioned* path,
> not a reverse-engineered one. This topic is the shared legitimacy + SDK-facts
> hub for the Copilot integration family, and scopes **Architecture C: a direct
> YA Copilot provider** built on the SDK/CLI. Sibling architectures:
> [`opencode-copilot.md`](opencode-copilot.md) (A: via OpenCode — current
> near-term plan) and [`copilot-oauth-claude.md`](copilot-oauth-claude.md) (B:
> Claude TUI fronting an SDK-based gateway).

Topic: copilot-provider

See also: [`opencode-copilot.md`](opencode-copilot.md),
[`copilot-oauth-claude.md`](copilot-oauth-claude.md),
[`provider-abstraction.md`](provider-abstraction.md) /
[`provider-state-machine.md`](provider-state-machine.md) (the `AgentProvider` /
`AgentSession` contract any new provider implements),
[`grok.md`](grok.md) (the isolated-additive provider template to copy),
[`cost-efficiency.md`](cost-efficiency.md).

## Correction recorded (2026-06-21)

Earlier drafts in this family called the Copilot path "probably inferior" and
"TOS-questionable," and one claimed there was no sanctioned way to drive a
non-Copilot client. That was wrong — built on a comparison blog and search
paraphrases rather than the governing terms and GitHub's official SDK. The
primary-source position below supersedes it. Credit to the user for pushing back
with specifics.

## The three architectures (all sanctioned)

```
A. OpenCode → Copilot            opencode is the harness; YA drives opencode.   (near-term plan)
B. Claude TUI → SDK gateway →    Claude Code is the harness, billed to Copilot
   Copilot                        via a YA-built Anthropic-Messages gateway on the Copilot SDK.
C. YA → Copilot SDK/CLID →       YA is the harness/supervisor; a first-class YA
   Copilot                        `copilot` provider talks the SDK directly.
```

A is [`opencode-copilot.md`](opencode-copilot.md); B is
[`copilot-oauth-claude.md`](copilot-oauth-claude.md); C is this topic.

## Why this is allowed (primary sources)

- **GitHub Copilot SDK is for third-party embedding.** Its
  [authentication docs](https://docs.github.com/en/copilot/how-tos/copilot-sdk/authenticate-copilot-sdk/authenticate-copilot-sdk)
  target "Web applications where users sign in via GitHub" and "SaaS applications
  building on top of Copilot," and "make Copilot API requests on behalf of users
  who authorize your app" — i.e. each user's own Copilot subscription/entitlement.
- **Auth inputs the SDK accepts:** stored OAuth credentials (from a prior
  `copilot` CLI login, in the system keychain); GitHub OAuth user tokens
  (`gho_`, `ghu_`, `github_pat_`); and env vars in priority order
  **`COPILOT_GITHUB_TOKEN`** (recommended), `GH_TOKEN`, `GITHUB_TOKEN`.
- **Terms:** individual Copilot subscribers are governed by **Section J (AI
  Features)** of the GitHub ToS (Business/Enterprise → Copilot Product Specific
  Terms); GitHub's API terms expressly cover "use of the API through a third
  party product that accesses GitHub" (Section H). So a third-party app using a
  user's own Copilot OAuth is contemplated, not prohibited.

### Not yet verified by me (verify empirically)

- **Opus / full model set via the SDK.** The auth page doesn't enumerate models,
  and the SDK overview page 404'd on fetch. The user's local `opencode models`
  already lists `github-copilot/claude-opus-4.8` (and gpt/gemini), so Copilot
  clearly serves Opus to this plan; that the *SDK surface* exposes the same set is
  very likely but should be confirmed by listing models through the SDK/CLI.
- **Exact Section J text.** Confirmed individuals fall under Section J and that
  API-via-third-party is contemplated; did not read Section J line-by-line for
  the absence of any relevant restriction. Treat "no client restriction" as the
  user's reading, well-corroborated but worth a direct read before relying on it
  in a public doc.

## Architecture C — a direct YA `copilot` provider

YA registers a new `copilot` provider (the [`grok.md`](grok.md) isolated-additive
template): new `ProviderName`, a new
`packages/server/src/sdk/providers/copilot*.ts`, additive registration +
`ENABLED_PROVIDERS` gating, no edits to `Process`/`Supervisor`/event bus/other
providers. It drives the Copilot SDK (or `copilot` CLI), authenticates from the
user's stored Copilot OAuth / `COPILOT_GITHUB_TOKEN`, exposes Copilot's model set
(incl. Opus, plan-permitting), and normalizes events to YA `SDKMessage`s.

Trade-offs vs Architecture A (OpenCode):
- **Pro:** no opencode dependency; YA owns the transport and normalization; one
  fewer moving part for Copilot-only users.
- **Con:** YA reimplements what opencode already does (model catalog, streaming,
  tool/permission normalization); opencode is further along today. Whether the
  SDK provider is *better* than opencode is now an empirical quality question,
  **not** a legitimacy one.
- **Same harness-gap profile as opencode:** YA (not Claude Code) is the harness,
  so the first-party Claude Code features (its system prompt, hooks, skills, Tool
  Search, Anthropic prompt caching) are not present — see the gaps catalog in
  [`copilot-oauth-claude.md`](copilot-oauth-claude.md).

## Implementation / operational considerations (not legitimacy blockers)

- **Single-user local YA:** simplest auth is reuse the `copilot` CLI's stored
  credential or set `COPILOT_GITHUB_TOKEN`. **Multi-user/hosted YA:** register a
  GitHub App and have each user authorize (per-user `gho_`/`ghu_` tokens).
- **Quotas/policy:** Copilot premium-request limits and org policy still apply;
  Opus may require a higher Copilot tier. Surface plan/policy errors clearly.
- **Cost boundary:** as with opencode, ensure ambient model-provider API keys
  don't silently switch billing off the Copilot entitlement (see
  [`opencode-copilot.md`](opencode-copilot.md) P1.3 and
  [`cost-efficiency.md`](cost-efficiency.md)).

## Status / recommendation

- **Near-term: stay on Architecture A** (opencode→Copilot,
  [`opencode-copilot.md`](opencode-copilot.md)) — it's the furthest along.
- **Architecture C is a verified-allowed, viable alternative**, worth building if
  the opencode dependency or its harness gaps become limiting, or if a
  Copilot-only audience wants a leaner path. Start with the model-exposure +
  SDK-auth empirical checks above.

## Sources

- [GitHub Copilot SDK authentication](https://docs.github.com/en/copilot/how-tos/copilot-sdk/authenticate-copilot-sdk/authenticate-copilot-sdk)
- [GitHub Terms for Additional Products and Features (Section H, API via third-party)](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features)
- [GitHub Terms of Service — Section J (AI Features)](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)

<!-- epistemic status: GitHub Copilot SDK auth docs + GitHub ToS direction + local
opencode model evidence, verified 2026-06-21. SDK model enumeration (Opus) and the
full Section J text are flagged as not-directly-verified. Supersedes earlier
"probably inferior / TOS-questionable" framing. -->
</content>
