# Graehl CI Pre-Kzahel Gate
> The graehl CI pre-kzahel gate makes the graehl push path prove the browser,
> relay, and resume cases that should not be delegated to kzahel/main.

Topic: graehl-ci-pre-kzahel-gate

## Purpose

Pushing first to `graehl/yepanywhere` should act as a small staging gate before
the same work is pushed to `kzahel/yepanywhere`. The gate is useful only if it
answers two questions:

- Did CI run the browser/e2e surface that can catch hosted-client and relay
  regressions?
- Did that surface include the regression shape the change is meant to protect,
  rather than only a happy-path smoke test?

This is not a replacement for local focused testing. It is a post-push check
that the public branch would have caught the bug class before it reaches kzahel.

## Standing Remote Invariant

`origin` (`graehl/yepanywhere`) is the development branch and promotion gate
for `kzahel`. Its purpose is frequent, early CI feedback from coherent commits
that are believed likely to pass—not storage for every commit and not a branch
held back until release confidence. Push before full satisfaction when the
current checkpoint probably works. Delay known-broken, super-WIP, or
amend-likely work: avoiding a predictable follow-up force push is part of the
intent. `origin/main` therefore need not mirror local `main`.

Ordinary and force pushes to `origin` are development-state writes and do not
require the big-effect push gate. Force pushes still use
`--force-with-lease --force-if-includes`; skipping the gate does not justify a
bare force. Every commit pushed to `kzahel/main` must already be reachable from
`origin/main`. `origin/main` may lead `kzahel/main` while work is staged, but it
may trail only when local `main` itself trails. The `kzahel` push remains
gated.

If `origin/main` diverges and a fast-forward cannot restore this invariant, a
lease-protected force push of `origin/main` is permitted only when the
resulting history remains consistent with `kzahel/main`. Never rewrite
`kzahel/main` as part of that repair.

On 2026-07-24, an agent pushed a reviewed commit to `kzahel/main` before
`origin/main`, then oscillated between withholding all newer local commits and
mirroring the full local tip. The correct decision surface is likely-green
checkpoints: push them to `origin` freely and often, delay known-WIP work, and
promote to `kzahel` only after the intended commit reaches `origin`.

## Current Evidence

On 2026-06-04, the relay resume incompatibility bug exposed the gap:

- `graehl/yepanywhere` CI for `503de19` passed, including `e2e-tests`; the log
  ran `e2e/relay-integration.spec.ts` fresh login, refresh resume, mock project,
  wrong-password, and offline cases, but no stale cached old-protocol resume
  fixture. Run: <https://github.com/graehl/yepanywhere/actions/runs/26805488818>.
- `kzahel/yepanywhere` CI for current `main` at `ad4385fd` also passed with the
  same relay e2e shape, and `503de19` is in that history. Run:
  <https://github.com/kzahel/yepanywhere/actions/runs/26969621063>.
- After `a2b5137`, `graehl/yepanywhere` CI did run the new
  `old relay resume session falls back to fresh login` e2e fixture and that job
  passed. The same workflow run was still red because unrelated client unit
  tests in `ExploredToolGroup.test.tsx` failed, so overall CI color alone did
  not give a clean release signal. Run:
  <https://github.com/graehl/yepanywhere/actions/runs/26976957494>.

The conclusion is narrower than "relay e2e was absent": relay e2e existed, but
the exercised cases were not adversarial enough to catch an already-connected
browser with cached stale resume material.

## Mini-Gate Contract

Before pushing a relay, hosted-client, authentication, resume, or browser-cache
change from `graehl` onward to `kzahel`:

- Wait for the `graehl/yepanywhere` `CI` workflow on the exact commit or pushed
  branch tip.
- Confirm `e2e-tests` ran `e2e/relay-integration.spec.ts` unless the change is
  demonstrably outside relay/browser behavior.
- For regression-driven fixes, grep the e2e log for the specific regression
  test name, not only the spec filename or the final pass count.
- Treat a missing expected test name as a coverage failure even when CI is green.
- Treat red non-relay jobs as a separate signal-quality problem: either fix
  them before pushing onward, or explicitly record why they are unrelated and
  why pushing to kzahel is still intended.

## Improvements

- Add a small helper script that fetches the latest graehl run for a commit and
  checks job conclusions plus required e2e test-name patterns.
- Keep required patterns close to the topic or in a committed config, so a
  future relay/security fix can add its new regression name before the kzahel
  push.
- Make the gate compare the graehl and kzahel workflow shapes when possible:
  same workflow present, same relevant job present, same relay spec names in
  logs. A missing or skipped kzahel job should be visible before push.
- Restore graehl CI to low-noise green on normal main pushes so the gate can be
  stricter than "the one job I care about passed."

## Related Topics

- [`topics/security.md`](security.md)
- [`topics/trusted-client-packaging.md`](trusted-client-packaging.md)
- [`topics/relay-origin-and-share-gating.md`](relay-origin-and-share-gating.md)
