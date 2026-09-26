# API auth-boundary test removes its data dir while artifact state is written

`packages/server/test/auth/api-auth-boundary.test.ts` builds a full app with
`createApp` and its `afterEach` calls `fs.rm(dataDir, { recursive: true })`
after `disposeSessionReaders()`, without waiting for the app's
`ArtifactServer`. That server restores and saves its grant state under
`<dataDir>/artifacts` asynchronously from construction (`ArtifactServer.ready`,
then `GrantStore` writes), so the removal can race a write and fail with
`ENOTEMPTY: directory not empty, rmdir '…/artifacts'`.

Observed once in a full `pnpm test` run ("refuses every /api route addressed to
a foreign host"); three isolated reruns of the file passed. Not fixed in place
because it was found while landing an unrelated harsh-review item.

Cheap fix: in `afterEach`, await `instance.artifactServer.ready` (ignoring its
rejection) and `instance.artifactServer.close()` before removing `dataDir`.
Other tests that build a full app and delete its data dir may share the race;
check them together.

Found 2026-09-26 while fixing harsh-review F8 (artifact frame sandbox).
