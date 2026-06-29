# Install-Id LocalStorage Excision

Status: Implemented 2026-06-29.

This note tracks removal of the client-side install-id localStorage scoping
layer. The goal is to reduce settings/storage confusion without changing current
production behavior.

## Motivation

`packages/client/src/lib/storageKeys.ts` says localStorage keys are split into
browser-global `UI_KEYS` and install-id scoped `SERVER_SCOPED_KEYS`. In
practice, production does not set the client-side install id:

- `InstallIdProvider` exists but is not mounted by `App` or `RemoteApp`.
- Full-history grep found no `<InstallIdProvider>` mount.
- The provider is stale if mounted locally: it calls
  `connection.fetch("/api/server-info")`, while the direct connection already
  prefixes `/api`, so it would request `/api/api/server-info`.
- Therefore `currentInstallId` remains `undefined` in production.

For calls that pass a legacy key, `getServerScoped` / `setServerScoped` fall
back to the legacy unscoped key. Current production behavior is therefore
browser-local legacy localStorage, not install-scoped localStorage.

The recent multi-server client summary/source work solves the concrete hosted
remote collision problem for drafts by using `ClientSummarySourceKey`, not
server install id. Draft storage now belongs to the source-scoped draft helpers
and `docs/tactical/027-client-summary-source-registry.md`.

## Provenance

The install-id localStorage layer was introduced by commit `ad9067db`
(`create a unified storage keys interface`, 2026-01-13). That commit:

- added `InstallIdProvider`;
- added `storageKeys.ts`;
- added `installId` to `/api/server-info`;
- centralized browser UI keys under `UI_KEYS`;
- wrapped model/thinking, notify-in-app, recent-project, and push device id
  storage in `getServerScoped(..., LEGACY_KEYS.foo)`;
- originally included install-id key builders and migrations for drafts and FAB
  drafts.

The draft/FAB migration pieces were removed by commit `7176c157`
(`Scope new session drafts by source`, 2026-06-28). That commit moved
new-session and FAB drafts to `ClientSummarySourceKey`, and intentionally left
draft recovery as current-format local client state rather than carrying forward
install-id draft migrations.

Later commits added more entries to `SERVER_SCOPED_KEYS` and tests that call
`setCurrentInstallId` manually. Those tests validate a hypothetical scoped mode,
not current app-shell behavior.

## Current Behavior Preserved

The implementation preserved production behavior:

- model selection uses `yep-anywhere-model`;
- thinking settings use their existing `yep-anywhere-*` legacy keys;
- show-thinking uses `yep-anywhere-show-thinking`;
- speech method / Smart Turn / Grok audio / Parakeet model / browser xAI STT key
  use their existing `yep-anywhere-*` local keys;
- browser profile id uses `yep-anywhere-device-id`;
- notify-in-app uses `yep-anywhere-notify-in-app`;
- recent project uses `yep-anywhere-recent-project`;
- source-scoped draft storage remains unchanged.

One exception needed an explicit decision: `forkSummaryAutoOpen` called
`setServerScoped("forkSummaryAutoOpen", ...)` with no legacy fallback. Because
there was no install id in production, writes were a no-op. The implemented
excision keeps this behavior non-persistent and default-off. A product-fixing
follow-up may add an explicit browser-local or source-scoped key, but that is a
behavior change and should be called out.

Do not remove the server's install id itself. Server install id remains useful
for relay registration ownership, compatibility notices, diagnostics, and
server identity. This tactical is only about client localStorage scoping.

## Implemented Shape

The first change stayed mechanical and behavior-preserving.

1. Replaced `getServerScoped` / `setServerScoped` call sites that passed legacy
   keys with direct reads/writes to explicit localStorage keys.
2. Added named `BROWSER_LOCAL_KEYS` constants in `storageKeys.ts` so preserved
   key names are clear.
3. Removed `SERVER_SCOPED_KEYS`, `serverKey`, `currentInstallId`,
   `setCurrentInstallId`, `getCurrentInstallId`, and `migrateLegacySettings`.
4. Removed `InstallIdContext.tsx` and the `useInstallId` imports that only
   existed for the dead localStorage scope.
5. Rewrote tests that manually seeded `setCurrentInstallId` to seed the real
   production keys directly.
6. Added/adjusted focused tests for behavior-preserving key paths: model and
   thinking storage, recent-project restore, notify-in-app, browser profile id,
   show-thinking, and speech/browser STT choices.
7. Kept `forkSummaryAutoOpen` non-persistent and default-off. If it should
   persist, implement a named browser-local or source-scoped key in a follow-up
   and document the behavior change.

Avoid broad refactors while doing this. The intended review shape is "remove a
dead abstraction and preserve actual storage keys."

## Documentation Follow-Up

Docs that described install-id localStorage scoping as real settings
infrastructure were updated during implementation.

Updated docs:

- `topics/settings-ui-placement.md`
  - Replaced the per-install localStorage mechanism with browser-local and
    source-scoped client storage categories.
  - Reclassified `showThinking` and similar settings according to actual
    browser-local storage.
  - Recorded that `forkSummaryAutoOpen` remains intentionally non-persistent.
- `topics/opencode-backend.md`
  - Aligned `showThinking` with the browser-local key.
- `topics/direct-xai-speech.md`
  - Replaced the old storage description with the explicit browser-local xAI
    STT key.
- `topics/pluggable-speech-recognition.md`
  - Aligned `speechMethod` with the explicit browser-local/server-default
    split.

Also search before landing:

```sh
rg -n "server-scoped|installId|InstallIdProvider|getServerScoped|setServerScoped|SERVER_SCOPED_KEYS|serverKey" topics docs packages/client/src
```

Do not rewrite relay/server install-id docs unless they specifically discuss
client localStorage. Relay install id is still valid server identity.

## Acceptance Criteria

- No production code imports `InstallIdContext`.
- No production code imports or calls `setCurrentInstallId`,
  `getCurrentInstallId`, `getServerScoped`, `setServerScoped`, `serverKey`, or
  `SERVER_SCOPED_KEYS`.
- `storageKeys.ts` no longer claims browser preferences are install-id scoped.
- Tests do not manufacture install-scoped localStorage state unless a separate
  source explicitly owns that behavior.
- Existing production localStorage keys continue to be read and written.
- Source-scoped draft keys and indices are unchanged.
- Topic docs no longer teach install-id localStorage as a supported settings
  mechanism.

## Open Questions

- Should `forkSummaryAutoOpen` persist at all? If yes, should it be
  browser-local like most UI preferences or source-scoped like drafts/session UI
  handoff state?
- Should browser profile id remain a localStorage key named
  `yep-anywhere-device-id` for compatibility, or should a future migration
  rename it once the scoped abstraction is gone?
- Should settings changes get a first-class activity-bus event after the storage
  cleanup? That is separate from this excision and should be tracked in its own
  settings consistency note if pursued.
