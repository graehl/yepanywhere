# Subprocess Environment Boundaries

> Environment behavior crosses several independent boundaries: the shell that
> starts YA, YA startup normalization, runtime config, provider-specific child
> filtering, subprocess stdio, and shell startup files. Tests must control each
> boundary they depend on.

Topic: subprocess-environment

This topic is the cross-cutting contract for environment propagation and
environment-dependent subprocess tests. The catalog and naming rules for
individual YA variables remain in [ya-env-vars.md](ya-env-vars.md).

## Runtime contracts

- Opt-in [`ya-agent self`](agent-self.md) injects `AGENT_YA_API_URL` and
  `AGENT_YA_API_TOKEN` plus the owning runtime's private command directory.
  Ambient self credentials are stripped by the child filter before eligible
  Claude/Codex launches receive their own grant. `AGENTCTL_SESSION_ID` is an
  optional cross-check; the credential itself determines ownership.

- Treat `process.env` as ambient input, not a stable default. A developer shell,
  package runner, service manager, or parent agent may contribute variables
  that are absent in CI or a production service.
- Windows private-storage checks must verify the current account's object
  owner and exclusive ACL even when an inherited PowerShell module path names
  modules incompatible with Windows PowerShell. Such a module must not make
  ordinary packaged-server startup fail or bypass either permission check.
- Normalize legacy YA aliases once at startup. Canonical values win, aliases
  are removed, and downstream code should observe only canonical names.
- Consume-and-strip YA-private module variables before launching providers.
  Provider-specific child builders may then filter, retain, or inject values
  according to that provider's contract.
- Consume server operator credentials before launching providers. In
  particular, children never inherit `AUTH_COOKIE_SECRET`,
  `DESKTOP_AUTH_TOKEN`, or `YEP_PROVIDER_RUNTIME_TOKEN`; those authorize YA
  control paths rather than a provider API.
- An environment overlay such as `{ ...process.env, ...overrides }` can replace
  a value but cannot express removal. A child launcher that must block an
  inherited name needs an explicit filter or denylist after merging.
- Do not broaden shared child-environment filters merely because one provider
  or subsystem must exclude a variable. Ambient credentials and tool settings
  can be part of another provider's expected behavior; exclusions belong at
  the narrowest boundary with a documented reason.
- Environment is copied at process creation. Updating YA's environment or a
  server setting does not mutate an already-running provider process. Dynamic
  data needed by later grandchildren requires a provider-supported control
  channel or an explicit bridge such as the local `agentctl` `BASH_ENV` file.
- The shared provider host replaces ambient `AGENT_LAUNCHER`,
  `AGENT_LAUNCH_HARNESS`, `AGENT_LAUNCH_MODEL`, and `AGENT_LAUNCH_EFFORT` values
  with its launch snapshot before creating a worker, and deletes the markers'
  pre-2026-08-17 `YEP_AGENT_*` names so a nested YA cannot present the outer
  session's launch as this one's. Model and effort markers describe the initial
  launch only. The later session-id bridge is host-owned: every hosted worker
  installs `BASH_ENV` before `startSession` so Grok, Gemini, OpenCode, and Pi
  inherit it even when the adapter has no session method. Claude and Codex
  still chain their own bridges. A resume may also set `AGENTCTL_SESSION_ID`
  on the worker environment; a new session receives it through the bridge
  file once the provider reports its canonical id.
- The bridge owns `AGENTCTL_SESSION_ID` outright: it is stripped from every
  spawn environment the bridge extends, and the bridge file clears the
  variable before sourcing the canonical session-id file. An inherited id is
  worse than no id. YA may be started from an agent's own shell, so the server
  — and any provider worker forked from it — can carry that session's id;
  handing it to a tool shell makes `agentctl` confidently maintain a live
  peer's coordination entry instead of this session's, and refuse-on-missing
  is the safe failure. For the same reason a *seeded* resume id is replaced,
  not merged, when the provider reports its canonical id: a forked session is
  launched from a copy of another session's transcript, so the id it started
  with is not the one it is running under. `copyAgentctlBashEnvInto` publishes
  any id it copies for the same reason — an id present only on the spawn
  overlay would be cleared by the bridge file and never restored. The overlay
  copy still matters for shells that never source `BASH_ENV` (codex's sandbox
  can strip it). The agent-side half of this contract — the environment
  outranking an id an agent passes or remembers — is `topics/agentctl.md`
  § Own id: the environment wins, in the `~/agents` helper repo.
- Publish agent-facing markers under the unprefixed `AGENT_` namespace. The
  shared child filter strips arbitrary inherited `YEP_*` / `YA_*` values as YA
  configuration; current wake, browser-debug, Gateway-route, and Copilot-backend
  outputs survive only as explicit compatibility exceptions. They are migration
  debt tracked in `gaps/agent-facing-env-markers.md`, not naming precedent.

## Shell-startup contracts

- `BASH_ENV` is a Bash startup mechanism, not generic child-process
  inheritance. It is evaluated by an ordinary non-interactive Bash invocation;
  other shells and direct executable launches do not source it.
- Bash may select a remote-shell startup path when its stdin looks
  socket-backed. On affected Bash builds that path reads `.bashrc` instead of
  `BASH_ENV`. Test runners commonly use pipes or Unix sockets internally, so a
  shell probe that inherits the runner's fd topology can test a different
  startup path than the provider launch it is meant to model.
- Tests that prove ordinary non-interactive `BASH_ENV` behavior must choose
  stdio explicitly. Use ignored stdin and captured stdout/stderr
  (`stdio: ["ignore", "pipe", "pipe"]`) unless the production boundary being
  tested intentionally supplies different stdin.
- A fake provider or nested shell is evidence for production only when its
  relevant environment and stdio topology match the real launcher. Make those
  choices visible at the spawn site rather than relying on Node or test-runner
  defaults.
- The local `agentctl` bridge captures an existing `BASH_ENV` path at launch,
  avoiding recursive lookup through a nested bridge's inherited environment.
  It also records that path in `YEP_ORIGINAL_BASH_ENV` for compatibility,
  sources the captured file, then sources YA's atomically updated session-env
  file. That file publishes `AGENTCTL_SESSION_ID` plus session-scoped outputs.
  Current builds use the legacy `YEP_*` wake and browser-debug pairs; the
  reader-first migration to canonical `AGENT_*` pairs is tracked in
  `gaps/agent-facing-env-markers.md`. Tests must cover chaining, quoting, and
  initially known resume ids without depending on the developer's own bridge.
- A [session-sandboxed](session-sandboxing.md#session-environment-bridge)
  Claude or Codex launch keeps its bridge in host temp, which the sandbox's
  private `/tmp` hides, so the sandbox mounts that one directory read-only at
  a fixed private path and the bridge writes that path into `BASH_ENV` and
  its own file. The captured outer `BASH_ENV` stays unreadable there and is
  skipped.

## Hermetic-test contracts

- Server unit tests start from built-in config defaults.
  `packages/server/test/setup/hermetic-env.ts` removes every static
  `process.env` name read by `config.ts`; the AST guard in
  `packages/server/test/config.test.ts` must fail when that scrub list drifts.
- That config guard covers only direct static reads in `config.ts`. Tests for
  provider bridges, shell startup, or other modules must also remove their own
  relevant ambient variables and supply every intentional value explicitly.
- Prefer `vi.stubEnv(...)` for a test-specific process variable so Vitest can
  restore it. For subprocess tests, construct a dedicated child environment
  and scrub conflicting inherited names before applying the values under test.
- `HOME` belongs to the safe-home test launcher, and deliberate harness gates
  such as real-SDK opt-ins remain under their owning test scripts. The ordinary
  server unit-test command gives the complete Vitest process a launcher-owned
  disposable `HOME` and `USERPROFILE`, then removes that exact directory.
  Real-SDK integration commands retain the operator home behind their explicit
  opt-in gates. Do not add either category to the general config scrub list.
- The safe-home launcher resolves workspace `vitest` and `tsx` entrypoints and
  runs them directly with Node on every platform. Native Node invocations also
  preserve arguments literally; Windows shell quoting must not alter their
  arguments or produce shell-launch deprecation warnings.
- Hermeticity includes descriptors and working directory when behavior depends
  on them; a clean environment object alone is not sufficient.

## Tests that should fail on contract regressions

- A newly added direct `config.ts` environment read is absent from the unit-test
  scrub list.
- A developer-exported YA config value changes a test that expects built-in
  defaults.
- An inherited `BASH_ENV`, `YEP_ORIGINAL_BASH_ENV`, or
  `AGENTCTL_SESSION_ID` changes an agentctl bridge test.
- The agentctl bridge stops chaining the prior `BASH_ENV`, publishing a later
  session id with its wake environment, or seeding a known resume id before
  provider startup.
- A hosted provider other than Claude/Codex (Grok, Gemini, OpenCode, Pi)
  starts without `BASH_ENV` or without `AGENTCTL_SESSION_ID` in later Bash
  shells after init.
- A session-sandboxed Bash shell reads an empty `AGENTCTL_SESSION_ID` after
  publication, misses a later replacement, or can see another launch's
  bridge.
- A Bash bridge probe accidentally inherits socket-backed stdin and silently
  exercises `.bashrc` startup instead of the intended `BASH_ENV` path.

## Related topics

- [ya-env-vars.md](ya-env-vars.md) — names, aliases, and consume-and-strip
  rules.
- [env-vars-config.md](env-vars-config.md) — proposed operator visibility and
  future child-process overrides.
- [cost-efficiency.md](cost-efficiency.md) — credential filtering and the
  metered-billing footgun.
- [claude.md](claude.md) and [session-liveness.md](session-liveness.md) — the
  local agentctl session-id bridge and its coordination-only semantics.

## Native sudo opt-in

`YEP_MC_SUDO_APP` and `YEP_MC_SUDO_TEAM_ID` are operator launch configuration,
not client-supplied session fields. Eligible local launches verify signatures
before adding the native resources directory to agent PATH. Restart the
provider host after changing its environment. See [native sudo](native-sudo.md).

## HTTP v0 launch credential

Both provider environment filters remove inherited `AGENT_YA_V0_*` names
case-insensitively. Only an explicitly eligible launch injects its own URL,
socket and complete Authorization header through spawn environment. This family
must not enter the legacy Bash bridge or cloneable worker launch options.
Codex API-enabled threads disable both shell snapshot features to avoid writing
the header to snapshots. See [HTTP v0](http-api-v0.md#local-agent-bootstrap).
