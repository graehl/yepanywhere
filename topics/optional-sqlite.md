# Built-in SQLite storage

> SQLite is normal YA storage infrastructure for keeping cold data out of RAM
> and avoiding startup-blocking JSON loads. It uses the runtime builtin, without
> a native package build. Product features keep their own enablement and retention
> policies; opening storage does not enable learning, search, or indexing.

Topic: optional-sqlite

Verified: 2026-09-10

See also: [YA environment variables](ya-env-vars.md) for `YEP_SQLITE` and
`YEP_DATA_DIR`.

## Startup policy

`YEP_SQLITE` accepts `off`, `auto` or `on`. An unset value means `auto`; invalid
values are configuration errors. Changes take effect after restarting the server.

## Data directory placement

The discovery database is only as fast as the filesystem holding the data
directory. Both adapters are synchronous and SQLite takes a file lock per
transaction, so a data directory on a network filesystem puts a network round
trip on the event loop for every transaction. Measured on an NFSv4 home with an
effectively empty database, the main thread spent 95% of samples in
uninterruptible sleep on `fcntl`, event-loop delay reached 6.5–10.7 s per
one-minute sample, and `GET /health` took 4–13 s while the dev frontend proxy
returned 502. The same database on local NVMe answered the same read
transactions in 0.008 ms.

So `auto` identifies the data directory's filesystem before opening anything.
On a network filesystem it opens no database, reports `error`, and names the
filesystem in the status so a client can advise moving the data directory.
Losing this database's features is a far smaller harm than a server that stops
answering. `on` skips the check and opens the database wherever the data
directory is, for an operator who has measured their own share; `off` still
disables storage entirely. `YEP_DATA_DIR` remains the way to place the data
directory on local disk and is what the refusal message and the client banner
recommend.

Classification is positive evidence only. `packages/server/src/lib/filesystemKind.ts`
owns the one table of filesystem identities, shared with scratch-space
selection, and names a category — network, memory-backed or a userspace FUSE
driver — because those callers fear different things. Only the network category
refuses SQLite: a FUSE mount names who implements the filesystem rather than
where the bytes live, and a memory-backed one takes locks locally. A filesystem
the table does not name, an uninspectable directory, and every platform whose
`statfs` numbers this table does not carry, currently macOS and Windows, are all
treated as local disk, so the check can cost a working install nothing.

Callers must not turn a large corpus into one transaction per item. Even on
local disk that is a lock per item; on a share it is the failure above. The
[issue/session association](issue-session-associations.md) catalog sweep is the
worked example: it reads the set of sessions a write could affect once, rather
than opening a write transaction per catalog row.

### When YA may choose the directory for the user

YA may offer to place the data directory only when both hold: no explicit
`YEP_DATA_DIR` or named `YEP_PROFILE`, and the default `~/.yep-anywhere` does
not exist yet. Either condition alone is the wrong trigger. An absent variable
fires on every start for the majority who never set one and are already on
local disk, and an absent directory alone would offer to relocate a directory
the user pinned deliberately, which
[hard development rules](hard-development-rules.md) § User Configuration Is
Authoritative forbids. When the directory already exists the question is no
longer selection but migration, with existing session metadata to preserve.

"First run" is not a separate condition to test: onboarding state lives at
`{dataDir}/onboarding.json`, so it is read from the directory whose location is
being decided, and the desktop runtime reports onboarding complete by default
and never writes that file at all. Directory absence is what first run means
here.

The filesystem refusal above deliberately has the opposite trigger and applies
to every resolved data directory, including an explicit `YEP_DATA_DIR`. Setting
that variable is an authoritative choice of location; it is not a claim that
the location can take file locks, and the consequence of being wrong is a
server that stops answering rather than a preference YA disagrees with.
`YEP_SQLITE=on` is the explicit way to accept that cost.

This default is infrastructure, not a feature opt-in. Independent features
still govern learning, indexing, retention, and their own background work.
An explicit `off` is a development/recovery escape hatch: SQLite-dependent
capabilities may be unavailable or hidden. The previous unset/off default
was not persisted by browsers, so it needs no client migration; restarting
updated YA with no explicit setting initializes storage automatically.

- `off` does not load either SQLite builtin, create a connection, or create a
  discovery database.
- `auto` attempts initialization once per Hono generation. A missing builtin
  produces `unsupported`; an open, filesystem, lock, or migration failure
  produces `error`. Either state preserves ordinary server operation.
- The desktop launcher supplies `auto` when `YEP_SQLITE` is absent and preserves
  an explicit inherited value, including `off`. `YEP_DESKTOP` alone is not a
  storage override.

The service retains status; version requests do not probe storage or retry
initialization. Restarting after correcting an error performs another attempt.
Server logs retain initialization error details; wire status contains no paths
or raw exception messages.

Close failures are also logged and do not interrupt the remaining app teardown.
The service clears its connection and reports `error` after a failed close.

## Runtime adapters

The server selects `bun:sqlite` when running under Bun and otherwise attempts
`node:sqlite`. Loading is guarded and deferred until storage is enabled. No
SQLite package, native installer, sidecar, or compiler is added to the core
distribution. Desktop's pinned Bun is tested directly, independently of claims
about newer Bun versions' Node compatibility.

### Runtime-Portable SQLite

`@yep-anywhere/shared/sqlite` is deliberately the *intersection* of the SQLite
backends YA supports: `node:sqlite` on Node, `bun:sqlite` on Bun. Server, relay
and push broker all go through it. Keep backend-only capability behind that
boundary. `node:sqlite` also offers `columns()`, `iterate()`, `setReadBigInts()`,
`setReturnArrays()` and the named-parameter toggles; the adapter exposes none of
them, and no Bun equivalent either. Where the backends differ in type, the
contract takes the narrower common one: a BLOB is a `Uint8Array`, never a Node
`Buffer`.

`finalize()` is the one deliberate exception, because the concept itself is not
symmetric — Bun statements own native resources and Node's do not. The adapter
offers it to every caller and makes it a no-op where the runtime has no such
concept.

The failure this prevents is invisible on the runtime most people test. A caller
that prepares the same SQL on every call looks free on Node, where
`StatementSync` has no `finalize` and the collector reclaims each statement, and
retains every statement until close on Bun. So `pnpm test` sets
`YEP_SQLITE_STATEMENT_CEILING` in each package's vitest config, and that pattern
fails where it is written rather than in a Bun deployment nobody exercised. Reuse
one prepared statement per SQL. Do not raise a package's ceiling to make a
regression pass.

If complying carries a real performance cost, do not widen the interface
quietly. Measure the cost, state it in the commit message and in the discussion,
and get maintainer consensus across every deployment that uses the adapter —
standalone Node server, Bun server, Desktop's pinned Bun, relay, push broker —
before revising the boundary. The disclosure is the contract: an unexplained
backend-specific call is a defect even when it is faster.

`YEP_SQLITE_STATEMENT_CEILING` fails an open database once its live prepared
statements pass the given count, naming the most repeated SQL. It is unset in
production and set in each package's vitest config, because preparing per call
is free-looking on Node and unbounded on Bun. Reusing one statement per SQL
keeps the count flat regardless of request volume.

The adapter is `@yep-anywhere/shared/sqlite`. The server reaches it through
`packages/server/src/storage/sqlite.ts`, which re-exports it so packaged
`dist/storage/sqlite.js` keeps the path the runtime contract scripts load.
Relay and push broker import it directly; one implementation serves all three
rather than each carrying its own native addon.

The adapter exposes synchronous prepared statements with positional parameters,
SQL execution, transactions, and idempotent close. Values are strings, null,
byte arrays, and numbers; integer inputs/results must fit JavaScript's safe
integer range. A missing single row is `undefined` on both runtimes. `run`
returns the affected `changes` count, which both runtimes report as a number.
`get` and `all` take an optional row type that is the caller's assertion about
its own SELECT, exactly as a cast would be; SQLite supplies no column types.
BLOB columns come back as `Uint8Array` on both runtimes, never Node `Buffer`.
A caller that cannot degrade without storage uses `openSqliteOrThrow`, which
fails with a runtime-requirement message instead of returning undefined.
Transaction callbacks must be synchronous; nested transactions and thenable
results are rejected. Callers must not begin or commit transactions manually
within a callback.
Future indexing consumers must bound their synchronous work rather than place
large scans on request paths.

Callers finalize statements when finished. Finalization drops the statement on
Node and explicitly releases its native resources on Bun. Closing the adapter
also finalizes outstanding Bun statements before closing the database; Bun
1.3.14's default close otherwise leaves them and the Windows file handle alive.
Using a finalized statement or one belonging to a closed adapter throws.

Node versions without an accessible SQLite builtin still load the published
modules and report `unsupported` in auto mode. Node's experimental-module notice
on applicable versions is not suppressed by the service.

## Database ownership and migration

The database is `{dataDir}/discovery.sqlite`, using the existing profile and
`YEP_DATA_DIR` resolution. No project or Git-metadata writes are introduced.
One connection belongs to each Hono generation and closes during the existing
reload/shutdown disposal path. Separate profiles have separate databases.

The initial schema reserves a YA application identity (`0x59414449`, ASCII
`YADI`). Historical version 2 added speech vocabulary tables; version 3 removed
its receipts/counts/staging tables. The remaining vocabulary state table is no
longer used: active learning settings and counts live in their separate JSON and
`speech-vocabulary.sqlite` files. See
[learned vocabulary](pluggable-speech-recognition.md#learned-vocabulary-contract).
Versions 4 through 7 add [issue/session associations](issue-session-associations.md):
durable issue/evidence tables, tracker confirmation, learned Jira prefix/site
mappings, and operational indexing/resolution/deletion state. Migration 7 only
schedules its URL-learning and candidate backfill; bounded post-startup worker
batches own the conversion.
Opening the database does not enable that experiment.

One statically registered, consecutive migration sequence owns `user_version`.
Historical SQL lives in frozen named modules; released migrations are append-only.
Do not edit, renumber or reuse them, or import mutable current feature schemas.
`discoveryMigrationPrefix(version)` builds historical fixtures with the actual
migration prefix. Resolve concurrent number collisions before landing.
Additive changes are preferred; data conversions need preservation/rollback
fixtures and a recovery plan. Provider reads and large backfills belong in bounded
resumable post-startup work, never migration initialization. A future destructive
conversion's backup must be a consistent SQLite backup, not a live file copy.

Pending migrations and version advancement run in one immediate transaction.
Foreign keys are enabled and lock waits are bounded to 250 ms, including the
migration lock. The default rollback journal remains unchanged. Even a no-op
startup takes the immediate lock; concurrent mixed-version profile use is not
supported, and contention may report error without data loss.

An existing foreign database, malformed database, or newer schema is refused.
YA does not reset or delete it. A failed migration rolls back its statements
and schema version. Initialization closes a partially opened connection before
retaining error status. The database is not disposable: issue decisions, manual titles and historical
evidence must survive independently of rebuildable indexing checkpoints.
There are no automatic down migrations. Disabling a feature does not roll back
the schema. An older reader that refuses this schema also loses discovery-gated
speech capabilities/routes, while preserving the separate speech files. Recover
by upgrading again or explicitly restoring a consistent pre-upgrade backup.

Existing JSON metadata/caches and OpenCode's independently owned database and
reader are unaffected.

Relay and push broker moved off `better-sqlite3` to this adapter on 2026-09-10,
so the repository ships no native SQLite addon and needs no compiler on any
host. Their `relay.db` and `push-broker.db` files are ordinary SQLite and were
not migrated or rewritten. Unlike the server's optional discovery store, both
exist to persist a registry, so a missing builtin is a startup failure rather
than a degraded state. That removes the Rocky Linux 8 prebuild floor that
previously broke both suites: the prebuilt binary required a newer glibc than
enterprise Linux 8 provides, and no library path could satisfy it.

## Availability and frontend compatibility

`GET /api/version` has an additive optional field:

```ts
sqlite?: {
  state: "disabled" | "unsupported" | "ready" | "error";
  networkFilesystem?: string;
};
```

An absent field means that source server does not report SQLite state. A
frontend must not infer readiness from its own runtime, desktop presence, or
server semver. The field passes through the existing source-scoped version
snapshot, including legacy and negotiated capability encodings.

`networkFilesystem` is present only when placement was the reason for `error`,
and it carries a filesystem name such as `NFS`, never a path or an exception
message. Both the local and hosted clients render it as one dismissible banner
recommending `YEP_DATA_DIR` on local disk, dismissed per named filesystem so the
advice returns if a later data directory lands on a different share. A client
that cannot see the field, talking to a server that does not send it, shows no
banner, which is the behavior every released client already has.

No generic SQLite capability ID is allocated. Future session discovery routes
must receive their own exact optional capability, advertised only when their
implementation and required storage are available. Storage readiness alone
does not enable discovery UI. Old/disabled servers receive no new requests;
older clients can ignore the new field. Existing capability meanings and protocol
levels are unchanged; the separately approved server runtime floor is documented in
[server runtimes](server-runtime.md).

The approved optional-feature corpus is v0.8.0 (2026-08-31) and v0.8.1
(2026-09-05): the latest two stable server releases and all stable server
releases within the preceding 14 days on 2026-09-08. Both lack SQLite status.
This change adds no frontend consumer, endpoint, or unsupported fallback call.

## Verification

`scripts/test-discovery-sqlite.mjs` runs the same contract against packaged
modules across the supported Node boundaries and Desktop's pinned Bun. It
covers persistence, parameters, rollback, migrations, newer/corrupt files,
contention, teardown and disabled/unsupported driver behavior. Shared-file
checks verify Node/Bun interoperability.

`scripts/test-sqlite-startup.mjs` checks real packaged `/api/version` state and
runtime identity in disposable profiles. The Server Runtime And SQLite workflow
also verifies fresh npm installation rather than only attached workspace deps.
Linux, macOS and Windows run full Node/Bun startup across disabled, ready and
error SQLite states. The [restored matrix](https://github.com/kzahel/yepanywhere/actions/runs/34485119811)
passed all twelve OS/Node combinations on 2026-09-10; Windows no longer excludes
full packaged startup.
Node 20 is no longer a supported main-server runtime; an old running server
remains compatible with the hosted frontend. See [server runtimes](server-runtime.md).

Related: [server capabilities](server-capabilities.md),
[YA environment variables](ya-env-vars.md),
[OpenCode storage](opencode-backend.md).
