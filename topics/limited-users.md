# Limited users

> Proposal: a second class of YA principal — a named limited user beside the
> single superuser — who logs in with their own credential (a username
> carried as the SRP identity over the existing relay claim, or standard
> HTTP auth on direct access), sees and
> acts on only the projects they own or are listed on, creates new projects
> only from templates, and whose sessions always run sandboxed; project
> membership is a per-project list of editors (later viewers) managed by the
> superuser or the project owner.

Topic: limited-users

Status: **v1 delivered (2026-09-20); the rest remains proposal.** See
§ Delivery v1 — Settings → Users for the committed contract.

The next template-creation extension is specified in
[project templates](project-templates.md#limited-user-permissions): server-enforced
None / Selected / Any permissions, with App canvas, Storybook and Web page
selected for new limited users (user-directed 2026-09-21). It is not delivered
in v1; the
[stand-up gap](../gaps/project-template-standup.md) tracks its implementation.

The same extension adds a superuser-managed **Private apps only** ceiling,
default-on for new and migrated limited users. It is a negative authority cap:
when enabled, project-template creation and later app-row mutations for that
user's projects must remain bearer-protected. When disabled, the user may opt a
new template app into Public access; private remains the default. The server
checks the ceiling at reservation creation/update, independently of the client
control.

### Approved workspace direction (2026-09-21; not implemented)

New limited users default their **Create in** directory to `~/username`,
editable by the superuser. This same directory is their default writable
session sandbox, allowing an agent to work across that user's own projects.
The superuser locks one of two modes in Settings → Users; a limited user does
not choose sandbox granularity in New Session:

- **Personal directory:** sessions can write within Create in, allowing work
  across that user's projects; paths outside it remain read-only.
- **Current project only:** sessions can write only to their active project,
  preventing cross-project writes even among their own projects. An explicit
  new-session grant also permits a session confined to a project outside Create
  in. In this mode the active project's writable root is not intersected with
  the personal directory. Other projects remain read-only.

Creation permission is independent: a user can be allowed to create projects
while locked to Current project only. A view/join grant is not a new-session
grant; entering an already-running session must not bypass its principal or
write-scope enforcement. Limited users never select an unsandboxed state.
Approved migration (user-directed 2026-09-23): apply the new defaults to existing
limited users too. Set Personal directory scope and Selected App canvas,
Storybook and Web page; fill an absent Create in root with `~/username`,
preserving a configured custom root and unrelated grants/provider locks.
This supersedes the earlier decision to preserve legacy project-only scope
and disabled creation. Apply once; later administrator choices survive
restarts. Existing running sessions keep their established sandbox until
relaunched; migration does not broaden live provider mounts.

Other host files remain readable under the existing filesystem sandbox
contract. For the household use case, siblings can be consulted from an agent
session; writes require the applicable mode and explicit new-session grant.
This is write confinement,
not a new confidentiality claim. YA project visibility and view/join/new-session
grants remain separate: a personal directory is not an API grant to every
project. Only the Current project only mode uses an explicitly granted external
project as its writable boundary.

Settings → Users keeps account/password, provider/model/effort locks, join
freshness and project grants together with the new Workspace & sandbox and
New projects sections. The template allowlist can deny creation without
removing the personal sandbox. The default write scope is Personal directory;
Current project only is a superuser-managed alternative, not a child-facing
per-session choice. Missing or invalid
workspace roots must not fall back to an unsandboxed launch or all of home.
See the [integration gap](../gaps/project-template-standup.md) for launch,
join/resume and filesystem enforcement checks before this becomes runtime.

Read as a local-credential and policy profile over the shared concepts
sketched in [[principals-and-grants]], not a separate approved authorization
architecture. That shared sketch is itself a proposal: it does not require a
hosted service or select a protocol. Relate any later slice to that broader
model and record the deliberately local seams; v1's are its own SRP identity
selection and its superuser-managed grant lists.

The background below was written against `684687c69` and describes the
pre-v1 state:

- One account, no usernames. `AuthService` holds a single bcrypt password
  hash and cookie sessions keyed by verifier; `verifyPassword` takes only a
  password. [[security]] states YA has no roles, no project access-control
  lists, and no operator/viewer split, and that a restricted multiuser layer
  "requires new principals, server-side authorization, and an enforced
  execution boundary".
- Direct access accepts a cookie session, a desktop cookie or token, or,
  when auth is disabled and localhost-open is on, everyone reaching the
  listener (`middleware/auth.ts`). There is no HTTP Basic or Bearer auth for
  the API.
- The relay reserves one **server name** per install: `server_register`
  with `username` and `installId`, first-come-first-served, reclaimable by
  the same install id, expiring after inactivity (`relay-protocol.ts`,
  `packages/relay/src/registry.ts`). That name is also the SRP identity. The
  relay has no account or user concept beyond that claim.
- Settings have three scopes: browser-local, source-scoped client storage,
  server-wide ([[settings-ui-placement]]). No server-side per-user partition.
  Browser profiles ([[browser-profile-devices]]) are device identities with no
  authority.
- Session sandboxing is implemented on Linux ([[session-sandboxing]]) and
  requires enforced authentication, but is documented as not a hostile
  multi-tenant boundary.
- Sub-operator authority exists only as bearer links: public shares
  ([[relay-origin-and-share-gating]]) and app links
  ([[active-content-security]] § Private app links).

## The idea in brief

The **superuser** is what a YA login is today: full ownership of every
project, setting, and session. When authentication is disabled, every
localhost browser is the superuser, exactly as now. A **limited user** is a
new named principal the superuser creates. Logged in, they see the same YA UI
but scoped: their own projects, the projects where they are listed as an
editor, New Project from template, and nothing else. Every session a limited
user starts runs sandboxed; the toggle is not theirs to clear. The superuser
keeps full access to everything, including limited users' projects, and
manages a per-project **members** list.

Motivating case: the household or small-team host. One machine runs YA; the
owner wants a child, a partner, or a collaborator to make and play with their
own template-born projects ([[project-templates]]) over the same relay,
without handing them the operator credential that can reach every project on
disk.

## Delivery v1 — Settings → Users

**v1** is the named, committed subset of this proposal. It replaces the
phase list below as the first thing actually built; the later phases remain
proposal. Everything in this section is a contract: an externally testable
outcome, enforced server-side at the operation, not by hiding a control.

**v1 scope in one line.** A superuser-managed set of limited users, each with
three per-project grants, an optional provider/model/effort lock, a
join-freshness offset, an optional project-creation directory, and
attributed usage; a **Settings → Users** page that creates them, edits
them, switches into them for testing, and logs out; relay login as a limited
user; and default-deny authorization for every API operation a limited user
makes.

**Feature gate.** `limitedUsersEnabled` in server settings, default off
([[vanilla-defaults]]). Off means no principal other than the superuser and
no limited-user login; turning it off while limited users exist keeps the
records but refuses their logins. That includes logins already signed in: a
live limited cookie, relay, or websocket login answers 401 and its
subscriptions are refused, never falling back to superuser authority. Their
unexpired sessions act again if the feature is turned back on. Settings →
Users stays reachable either
way, because it is where the switch and the first user both live.

### v1 user record

`limited-users.json` in the data directory, one record per username:

- `username` — the relay label grammar, 3–32 characters of lowercase
  letters, digits, and hyphens, first and last alphanumeric. Unique.
- `passwordHash` — bcrypt, for the direct cookie login.
- `srp` — `{ salt, verifier }` generated from the same password with the
  username as SRP identity, so the relay path verifies without a second
  credential. Changing the password rewrites both forms; neither form is
  ever returned by an API.
- `newSessionProjects: string[]` — projects where the user may start
  sessions. Every session they start is forced to `sandboxLevel:
  "project-write"`; the request cannot select `none`.
- `joinProjects: string[]` — projects where the user may send turns to a
  **fresh** existing session started by anyone.
- `viewProjects: string[]` — projects whose sessions the user may read.
- `joinStaleOffsetMinutes` — −5 to +60, default 0 (see freshness below).
- `lock: { provider?, model?, effort? }` — any subset; an absent field is
  not locked.
- `disabled?`, `createdAt`, `lastLoginAt?`.

Grants are a union, not a hierarchy: `newSessionProjects` and
`joinProjects` each imply view on their own projects, so `viewProjects`
only needs the read-only extras.

### Freshness

A session in a join project is joinable while
`now − lastActivity ≤ providerCacheWarmMinutes + joinStaleOffsetMinutes`.
`providerCacheWarmMinutes` is a believed prompt-cache-warm window per
provider, shipped as **60 for Claude-family providers and 10 for everything
else, Codex included** — the same zero point the stale-session cutoff above
describes. Outside the window the session is visible but read-only for that
user, with the reason stated; starting a new session stays available where
`newSessionProjects` allows it. v1 does not implement the redirect-into-a-new-
session behavior described above; it refuses the turn instead.

### Authorization

Enforcement is a single server-side middleware ahead of every API route, so
a route added later is refused for limited users until it is listed. It is
**default-deny**: a request path a limited principal is not explicitly
allowed gets 403, and a project or session outside the user's grants gets
404 (existence is not disclosed).

The decision is made on the path the router dispatches, after
percent-decoding, so an encoded spelling such as `/api/%69ssues` is judged
as the `/api/issues` route it reaches. A project grant comes only from a
project or session id in that path: a `projectId` query parameter opens
nothing, since most routes ignore one. An id segment that is not valid
percent-encoding is refused.

| operation | limited user |
|---|---|
| any API path not on the v1 allowlist | 403 |
| `GET` of a project-scoped path | allowed when the project is in any of the three lists, else 404 |
| session create in a project | `newSessionProjects` only; sandbox forced; lock applied |
| turn/approval/interrupt on a session | the session's project in `newSessionProjects` or `joinProjects`, **and** the session is fresh or started by this user |
| any session the user started | always at least readable, including after its project grant is removed |
| Issues & PRs (`/api/issues*`) | 403, and the nav entry is hidden: it spends the host's ticket-system credentials |
| Inbox, Projects, Source Control, All Sessions | served, with every project and session outside the user's grants removed from the response |
| Project Queue actions | promote-now needs `newSessionProjects` on the project in its path; pausing or resuming dispatch 403 |
| settings | `GET` of the client-facing settings document; every write 403 |
| user administration | 403 except `GET /api/users/me` and `POST /api/users/logout` |
| public shares, app links, devices, bang commands, absolute-path file reads, uploads outside a session, server admin, relay/remote-access config | 403 |

Session-to-project resolution for session-scoped paths uses the live process
first and the session catalog second; a session that resolves to no project is
refused. List filtering is by project only: a session the user started in a
project whose grant was later removed stays directly readable but no longer
appears in their lists. Sessions the user starts are recorded with `createdByUser` in
session metadata at create time, which is what makes the "always readable"
row above durable.

The same principal check gates websocket subscriptions: a limited user may
subscribe to a session channel only for sessions they may read, and the
global activity channel is filtered to their accessible projects.

A `/api/ws` socket acts as the login that opened it, for its whole lifetime.
An SRP socket acts as its proven identity; a directly opened socket acts as
the cookie login of its upgrade request. Its tunneled requests and its
subscriptions are both judged as that login, and a cookie header a client
puts on a tunneled request changes nothing. A limited user's direct socket
therefore gets exactly the 403/404 answers above, never superuser authority.

### Login, switching, and logout

- **Relay.** `srp_hello.identity` selects the verifier: the remote-access
  record for the superuser, else the limited user of that name. An unknown
  identity gets a challenge computed against a fixed dummy salt and verifier
  and fails only at the proof step, and every hello response is padded to a
  fixed floor, so response timing does not disclose which usernames exist.
  This closes the existing early "unknown identity" leak as well.
- **Direct.** The login page accepts an optional username; blank is the
  superuser. The cookie session records which principal it authenticated.
- **A relay-authenticated limited user is locked to that user** for the life
  of the connection: no switch control, and `POST /api/users/switch` is
  refused.
- **Switching (superuser only), from Settings → Users.**
  `POST /api/users/switch {username|null}`
  sets a server-signed `acting user` cookie, accepted only when the request's
  underlying principal is the superuser. Everything after that is evaluated
  as that limited user, which is how the restrictions get tested from one
  browser.
- **Logout.** In Settings → Users. For a switched superuser it clears the
  acting-user cookie and returns them to full access. For a limited user it
  invalidates their session and returns them to the login they arrived by:
  the relay login page for a relay session, the direct login page otherwise.

### Settings → Users

User management is an ordinary settings page, not a sidebar panel. A
single-user install must never be shown an account control it has no use
for, so nothing about limited users appears anywhere else until one exists.

- **The page.** Reachable whether or not the feature is on, and ordered so
  the switch comes first: the `limitedUsersEnabled` toggle, then the list of
  users, then an editor. Turning the toggle on is enough to add the first
  user — creating one also turns the feature on server-side, so neither step
  waits on the other. Each row carries the username, a grant summary, any
  lock, and Act as / Edit / Delete. The editor takes username and password,
  the three project lists as one per-project access level, the join-freshness
  offset, and the lock; model and effort completions populate from the
  provider catalog once a provider is chosen, and a blank field is unlocked.
- **Sidebar.** Nothing. No panel, no shortcut, no switcher, and no logout
  button: user management is reached through Settings like any other
  administration. The acting principal still reports `hasLimitedUsers`, a
  boolean and never a count, for surfaces that need to know an install has
  more than one principal.

- **Delete.** Confirmation names the user and explains that deletion removes
  the account, its grants and usage history while keeping project directories
  and files. Cancel sends no deletion request. Recreating a username creates a
  new account; it does not restore the deleted grants or usage history.

- **New Session, acting as a limited user.** The form offers only what the
  user can actually affect. A locked provider, model, or effort loses its
  picker — provider buttons, the model dropdown and its composer chip menu,
  and the thinking/effort panel — and the sandbox loses its toggle. What was
  withheld is stated instead, as a non-interactive "Set by your account"
  caption carrying the same abbreviated indicators the rest of YA uses (the
  provider badge for provider and model), plus the locked effort and
  "Sandbox: always on". Nothing in it is focusable or clickable. When the
  lock leaves a field free, that field keeps its ordinary picker; a lock that
  empties the whole provider/model/thinking column gives the column's width
  back rather than leaving a hole. The composer's model chip keeps its badge
  and loses its menu.

  The lock also outranks saved and per-project defaults in the form, and is
  reapplied over the launch body at submit, so a submit racing the
  acting-principal request still launches inside the lock. A side-session
  recap is cleared, since it cannot run beside the forced sandbox. Hiding
  remains cosmetic: the create route is the enforcement.

  A request names its reasoning budget as a thinking option (`off`, `auto`,
  or `on:<effort>`) while a lock names the bare effort. The route compares the
  effort each names: the same effort in either spelling is agreement, a
  request naming no effort takes the locked one, and a different effort is
  refused naming the locked value.
- **Limited user.** The same page shows them their own username, a read-only
  view of their grants and lock, and Log out. They cannot edit their own
  settings, and the directory is never fetched for them.
- **Their other settings categories are an allowlist.** Every server-settings
  write is 403 for them and whole route families behind these panes are
  denied, so a category they cannot operate is hidden rather than shipped
  inert — Local Access otherwise waits forever on `/api/network-binding`,
  which they may not call. They keep Appearance, Toolbar, Message delivery,
  Notifications, Users, and About. Like the route policy, the list is
  default-deny: a category added later is hidden from limited users until
  someone lists it. A hidden category does not render from a typed URL
  either. That suppression is about the principal alone: a category the
  server's capabilities dropped still renders its pane from a typed URL,
  because that pane's unsupported-server message is the answer the reader
  came for.
- **An older server** without `/api/users` makes the page say so rather than
  report a failure; no other client behavior depends on the route existing.

Nav entries a limited user cannot use are hidden, and the sidebar session
list shows only sessions in their accessible projects plus sessions they
started. Hiding is cosmetic; the middleware above is the enforcement.

### Usage

Every principal's work is attributed, so Settings → Users can say who used
this install and how much.

- **Attribution.** A session records the principal who started it, and every
  user turn carries `sentByUser` in its message metadata. Both are stamped
  server-side from the acting principal and never read from the request body,
  so a client cannot attribute its turn to somebody else. **Absent means the
  superuser** — which is also what every session and turn predating this
  means. A YA-injected prompt is nobody's turn and carries no sender.
- **The ledger.** `user-usage.jsonl` in the data directory, one short
  append-only record per session start, per user turn, and per settled
  provider turn's token charge: timestamp, username (absent for the
  superuser), and then a turn's word count or a charge's model short name,
  project name, and input/output token counts. Appending is
  the only write on the turn path. A torn record from an interrupted append
  costs itself and nothing else. The file is capped at 50,000 records,
  trimmed oldest-first, so a report's reach shrinks rather than its recent
  numbers going wrong. Deleting a user deletes their records.
- **Interaction time** is the union of the five-minute windows each action
  opens: one lone turn counts five minutes, two turns two minutes apart count
  as one continuous stretch rather than two, and a gap longer than five
  minutes starts a new stretch. This is the whole definition of "presumed
  away after five minutes"; no other idle signal feeds it.
- **Tokens** are what the providers charged for that principal's work, over
  every request their sessions made. Attribution is the session's recorded
  creator, so a charge lands on the principal who started the session that
  caused it. A token record is **nobody's action**: it moves no session count,
  no turn count, and no interaction time.
  - **Four classes, kept apart.** Prompt tokens the provider processed, prompt
    tokens it served from cache, prompt tokens it wrote to cache, and tokens it
    generated. They cost between a fiftieth and one times each other, so one
    summed "tokens" number is a **volume, not a cost** — that is what the page
    labels it, and every cost figure comes from the classes.
  - **Binned by provider, model and context tier**, which is everything the
    price of those counts depends on. The recorder accumulates per live process
    and appends **once per settled provider turn and tier** — on the turn's
    `result` frame, on the next turn starting, or when the process goes away.
    One streaming Claude response repeats its usage on every completed content
    block, so frames are deduped by the provider's response id; a provider that
    names no response, such as Codex's out-of-band `token_usage`, has each
    frame taken as its own request, since two real requests may legitimately
    report equal counts.
  - **The tier is decided at record time**, from the prompt one request
    actually sent, because no later reader can recover a single request's
    length from a sum. **The threshold is the provider's own, and most
    providers have none**: OpenAI reprices the whole request above 272k prompt
    tokens (prompt classes ×2, output ×1.5), while **Anthropic prices its full
    1M window flat** — it removed its own over-200k premium on 2026-03-13, so
    `sonnet[1m]`, `opus[1m]` and `fable[1m]` cost exactly what their short
    requests cost. A record carries the tier only when it is the long one, so an
    install on a provider without one pays nothing for the distinction, and a
    long-context flag on such a provider changes no price.
- **Cost is reported two ways, from one calculation.** The headline is
  **standard-tier output tokens of the model itself**: the charge's dollars
  divided by the one constant that model charges per output token. It leads
  because it keeps meaning the same thing when a price changes. Dollars are the
  **supplement** — the same calculation before that division.
  - Prices come from two tables, in order. `PUBLISHED_MODEL_PRICES` in
    `packages/shared/src/model-prices.ts` holds rates read from the providers'
    own pricing pages on a stated date, covering the models YA launches that the
    extract does not name — Opus 5, Sonnet 5, Fable/Mythos 5.1, the GPT-5.6
    family, GPT-6 Astra, and the Daybreak alias, which **is** GPT-5.6 Sol and
    carries its rates. Behind it, `packages/shared/src/vendor/pi-model-prices/`
    is a mechanical extract of the `pi` project's per-model rates; its
    `VENDORED.md` owns the upstream revision, and
    `scripts/generate-vendored-model-prices.mjs` refreshes it from a local `pi`
    checkout when someone chooses to.
  - **Per model, not per provider ratio.** Claude Fable 5.1 and Mythos 5.1
    price a cache read at 0.025x base input where every other Claude model is at
    0.1x, and OpenAI bills cache writes on GPT-5.6 and later but not on GPT-5.4
    or 5.5. A per-provider ratio table would price those models wrong by a
    factor of four.
  - **A model the table does not name still gets an output-token equivalent**,
    from generic ratios midway between the two listed families — output at 5.5
    fresh prompt tokens, a cache read at a tenth of one, a cache write at
    0.625. **It gets no dollar figure**, which is simply not shown rather than
    guessed. Those ratios track real compute asymmetry only roughly, which is
    why they yield a relative unit and never money.
  - **Dollars add across models; output-token equivalents do not.** So a
    per-model bucket shows both, and a per-project or whole-user bucket shows
    dollars alone — one model's output token is not another's, and summing them
    would not be a quantity. A bucket with any unpriced model shows no dollars
    at all, rather than a partial total that reads as the whole.
  - **A fast-mode Claude turn is under-reported.** Anthropic charges Opus 5
    and Opus 4.8 at $10/$50 rather than $5/$25 with `speed: "fast"`, and the
    ledger records no speed, so such a turn is priced at half. Noted in
    gaps/usage-cost-price-table.md.
- **The split is by model and, separately, by project** — never by the two
  together, which multiplies rows without answering a question anybody asked.
  The model name is the launch alias (`opus`); the resolved provider id is
  recorded separately, because that is what the price table is keyed by and the
  alias is what a reader groups by. Either name may be absent, and an unnamed
  charge collects in one bucket rather than being dropped. Buckets are ranked
  costliest first, with unpriced ones after the priced ones by raw volume.
- **The report.** `GET /api/users/usage`, superuser only, returns per-user
  totals and the same totals restricted to the last seven days, plus the
  timestamp of the earliest record. Settings → Users renders it as one row
  per principal with the superuser included. The all-recorded column names the
  **calendar days** the ledger spans, counting both ends, because the reader's
  question is which days are in here; the other column says "7 days" rather
  than "last week", which a reader otherwise takes for the last whole calendar
  week. A user with a record of nothing is listed by the
  report but not shown in the table; the ledger starts empty on an existing
  install, so the page says what it covers rather than implying all time.

### Project creation

A limited user creates projects only where the superuser said they may.

- **The grant.** `projectRoot` on the user record, a directory as the
  superuser typed it (`~/archer` keeps that form and expands server-side).
  **Absent means they may create no project at all**, which is the default:
  creation is a grant, not something a limited user has by existing. A
  relative root is no grant either — it would resolve against the server's
  working directory, which is not a boundary anybody chose.
- **The check** is at the route, not in the pure route policy, which cannot
  see a path carried in the body: `POST /api/projects` reaches the route for
  a limited user and is refused there unless the path is under their root.
  The root itself is the parent directory, not a project, and `..` cannot
  walk out of it. The superuser may still add anything.
- **A directory that does not exist yet** is offered rather than refused.
  The client asks, and only a request that explicitly says `create` makes
  it: YA creates the directory, runs `git init`, and leaves one empty commit
  so the first real change has a root revision to diff against. A host that
  configures no Git identity — the fresh machine this is most for — still
  gets that commit, from a fallback identity used for the scaffolding commit
  alone. Without that
  flag a missing path is still a 404, so nothing creates a directory by
  accident. An existing directory is never touched — YA does not run
  `git init` over somebody's tree. Only the leaf is created: a missing
  parent is an error, because building a whole tree from one typed path
  turns a typo into directories nobody meant to make.
- **Ownership.** The project records `ownerUsername`, absent for the
  superuser, and it survives the project being rediscovered by a
  session-directory scan once it has sessions.
- **Display.** A project a limited user owns reads as `owner/name` wherever
  a project is named for a person to pick — the Projects page, the project
  selector, the sidebar — because two people's `notes` are otherwise the
  same row. A project code name still wins where one is set.

### Out of v1

Viewers-versus-editors semantics beyond the three lists, session guests,
template-only project creation, the Settings → Limited Users grants recap
and summary line, HTTP Basic, per-user server sockets, the stale-session
redirect (v1 refuses instead), and mid-session lock enforcement for model or
effort changes made by the superuser.

## Principals and login

- **Superuser** — the existing single account. Unchanged semantics; the
  name is only for contrast.
- **Limited user** — `{ username, passwordHash, createdAt, disabled? }`
  in `auth.json`, created and reset only by the superuser. Usernames share
  the relay's label grammar (lowercase, 3–32 characters).
- **Relay login.** What the public relay supports today, from
  `relay-protocol.ts` and `packages/relay/src`: a name is 3–32 characters
  of lowercase letters, digits, and hyphens, starting and ending
  alphanumeric; hyphen is the only separator character and is legal inside
  ordinary server names, so the relay cannot parse a `server-user` compound
  and any install may claim `alice-bob` as its own name. One install may
  own any number of names, each on its own server WebSocket; only
  unauthenticated connections are capped per IP, and the slot is released
  once a registration or client protocol is accepted, so many registered
  sockets from one host are fine. The relay never sees SRP: the handshake
  terminates at the YA server, where `srp_hello.identity` must currently
  equal the single configured remote-access username and one verifier
  exists.

  Decision (2026-09-19): **a separate, optional username carried as the SRP
  identity**, not a compound relay name. The hosted login form gets a
  username field beside the server name; the client connects to the server
  name exactly as today for routing, then sends `srp_hello` with the
  limited user's username as identity, and the YA server selects that
  user's salt and verifier. The relay needs no redeploy and learns nothing
  new; there is no squatting or grammar ambiguity; and the principal is
  bound before any API call, as with the superuser. Cost: relay-side
  per-name limits (`muxOpenAttemptsPerMinutePerIpUsername` and the
  five-session cap) are shared by everyone under one server name, so a
  noisy guest can throttle the host; the server's own per-identity SRP
  limiter already exists to contain that.

  **Identity lookup and timing.** The server resolves the `srp_hello`
  identity by a constant-time map lookup of username to salt and verifier
  before the one modular exponentiation SRP needs per attempt, so cost does
  not grow with the number of users. Response time must not reveal whether
  a username exists (decided 2026-09-19): an unknown identity runs the
  same challenge computation against a fixed dummy salt and verifier and
  returns an indistinguishable error only at the proof step, and the
  handler pads every hello response to a minimum elapsed time (sleep to a
  floor such as the observed p95 of a real challenge) so a fast path cannot
  be distinguished from a slow one. The remaining signal is what network
  timing resolution allows: an attacker sees only round-trip times through
  the relay, so the floor needs to hide millisecond-scale differences, not
  microsecond ones, and jitter from the relay hop already masks most of
  it. Today the single configured name already leaks existence by
  answering "unknown identity" early; this closes that too.

  **Per-user server sockets** remain an option a new YA server can add
  without relay changes: register `<server>-<username>` on an additional
  socket per enabled user (an install may own many names), which gives
  relay-side per-user visibility and separate limits at the price of one
  relay socket per user and exposing usernames to the relay operator. It
  is a later refinement for hosts that need relay-side isolation, not the
  v1 login path, and it must still bind the principal from the SRP
  identity rather than trusting the name alone, since names are
  first-come claims.
- **Direct login.** The login page gains a username field, blank meaning
  superuser. For non-browser clients and for the simplest possible remote
  path, standard HTTP Basic over HTTPS is accepted as an alternative to the
  cookie flow, for limited users only: `Authorization: Basic` with
  `username:password`, verified against the same hash, rate-limited like
  login. The superuser is deliberately not reachable over Basic, so the
  operator credential never travels as a header. Basic is refused on plain
  HTTP except loopback.
- **Localhost-open and auth-disabled** are superuser-only modes; enabling a
  limited user requires enforced authentication, the same interlock
  [[session-sandboxing]] already applies.

## Authorization

A server-side check on every request, not a client filter. The principal is
attached by the auth middleware; each route family declares what a limited
user may do:

| surface | limited user |
|---|---|
| Projects list, project pages | only owned or member projects; others 404, not 403 |
| New Project | only from a template ([[project-templates]]), into a parent directory the superuser configured for that user; the created project is owned by them |
| Add existing directory | refused |
| Sessions in a member project | create, message, approve, fork, rewind; sandbox forced on; provider/model/effort within the user's lock (below) |
| Sessions elsewhere | 404 |
| Files, source control, git status | within member projects only; the same sandbox roots the session sees |
| Server-wide settings | read where harmless, write refused |
| Apps settings | only rows reserved for their projects ([[project-templates]] § App name reservation); Public is available only when the superuser has disabled Private apps only, and remains explicit opt-in |
| Public shares, app links | within member projects only |
| Devices, push, browser profile | their own |
| Agents/process view, Inbox, All Sessions | filtered to member projects |

The superuser sees everything and additionally the members UI.

Ownership is stored server-side, keyed by project id, in a new
`project-access.json`: `{ projectId: { owner: username | "superuser",
editors: [username], viewers: [username] } }`. It is YA app data, never a
file in the project ([[project-directory-storage]]).

**Members UI.** On the project page, superuser or owner only: an editors
list (add by username, remove), and later a viewers list. Editor means
start sandboxed sessions and everything in the table above. Viewer, later:
see sessions and transcripts, open the project's app, but no turns, no new
sessions, no files outside what the transcript shows.

**Session guest.** A second, narrower grant shape for live sharing of one
session with another person ("multiplayer"): the superuser, or a project
owner, creates a username and password whose entire scope is **one named
session**. Through the relay (the "reflector") the guest logs in with the
server name plus their own username as SRP identity, like any limited user,
so the server always knows which guest a connection is; on direct access it
uses the same login or HTTP Basic path. A guest sees that session's transcript, may send turns and approvals in
it (or is read-only, chosen at creation), and sees nothing else: no project
page, no file APIs beyond what the transcript shows, no session creation, no
fork. Anticipating the grant, the host may launch the session sandboxed at
creation so the guest's turns are confined; a guest grant on an unsandboxed
session is allowed but the members UI says so plainly. Guest records live in
`project-access.json` beside memberships as
`{ session: sessionId, guests: [{ username, mode: "turns" | "read" }] }`,
and revoking one ends its relay claim and cookie sessions. The
stale-session cutoff applies to guests too, but as **expiry rather than
redirect**: a guest grant is temporary and ends when the shared session has
been inactive for the configured cutoff, since a redirect into a new session
would fall outside the grant and an exemption would let a cold session be
resumed at full cost. The guest sees the remaining time and, once expired, a
plain "this share has ended" page; the host may re-share. A
session-continuation authority (which successor session a guest may follow
into) is not proposed here.

**Provider lock.** The superuser may pin a limited user to a provider, a
provider plus model, or provider plus model plus effort; any subset is
representable, but those three are the expected shapes. Stored on the user
record as `lock: { provider?, model?, effort? }`. Semantics:

- **New sessions** the user creates take the locked values, and the New
  Session form shows those fields fixed rather than offering a choice. A
  locked value beats [[session-defaults]] and any per-project default.
- **Existing sessions.** By default a limited user may send turns only to
  sessions whose current provider, model, and effort all fall within the
  lock; a session outside it is visible in member projects but read-only for
  that user, with the reason shown. The superuser may relax this per user
  (`lock.existingSessions: "any"`), which keeps the lock for creation only.
- **Mid-session changes** ([[mid-session-effort-change]], model switches)
  are refused for a locked field.
- The lock bounds what the user can spend and which provider account they
  reach; it is enforced server-side at session create and message routes,
  never only hidden in the form.

The check reuses the same provider, model, and effort identifiers the
session-create route already validates, so a lock names only values the
server could launch. An unlaunchable locked value blocks the user's session
creation with a clear message rather than silently falling back.

**Stale-session cutoff.** A child or casual user does not know that
resuming a session idle for a day misses its prompt cache and costs far more
than a fresh one. A per-user setting, a time slider (`staleAfter`), makes YA
redirect: when the user sends a turn to a session whose last activity is
older than the cutoff, the message instead opens a **new session** in the
same project. The slider is an **offset against the believed cache-warm
window of the session's provider and model**, not an absolute duration: the
per-provider retention window that [[prompt-cache-keepalive]] already
tracks is the zero point (currently configured as one hour for Claude and
ten minutes for Codex, which is fine for now). The slider ranges from −5
minutes (redirect slightly before the cache is believed cold) to +60 minutes
of grace, with a separate off position; the default offset is 0. One user
setting therefore behaves sensibly across providers without the user
knowing either window. The new session's first turn is
the user's text, prefixed with a short reference to the previous session
(its YA id and title) and a hint that the agent should read it if the
request refers to something not otherwise explained; the previous session is
left untouched. Beyond the cutoff the old session's composer shows the
redirect plainly ("this will start a new session"), so the behavior is
visible rather than surprising, and the superuser may set the slider to off
to keep ordinary resume behavior. The redirect is server-side at the message
route, keyed by the session's last activity time, so a stale client cannot
bypass it. The superuser may opt into the same setting for their own account
(decided 2026-09-19); it is off for the superuser by default and required
only for limited users. For session guests the cutoff expires the grant
instead of redirecting, as stated above.

## Grants management

Guest grants that are temporary by default make an explicit **permanent**
grant a deliberate act, and that act needs a place where everything the
host has handed out can be seen at once. Today the sub-operator grants are
scattered: public session shares have their own authenticated management
routes, app links are revoked per row in Settings → Apps, and interactive
artifact links have no inventory at all
([`gaps/artifact-grant-revocation-ui.md`](../gaps/artifact-grant-revocation-ui.md),
[`gaps/app-artifact-access-control.md`](../gaps/app-artifact-access-control.md)).

Proposed: a **Settings → Limited Users** category, superuser only, that is
both the user directory and the grants recap:

- **Users.** Each limited user with lock, stale cutoff, parent directory,
  enabled/disabled, last login, and reset/disable/delete actions.
- **Project memberships.** Every project's owner, editors, and viewers, the
  same data the per-project members UI edits, listed across projects so a
  name can be found and removed everywhere in one place.
- **Live shares.** Every session guest grant: session, guest name, mode,
  temporary or permanent, remaining time, last seen, revoke. A permanent
  guest is created only here or from the session's share menu with an
  explicit "does not expire" choice, and is marked in this list.
- **Document and app grants.** A read-only recap of the other bearer
  grants the host has outstanding, with revoke: public session shares, app
  links per vhost row and their generation, and interactive artifact links.
  This is the inventory the two gaps above ask for; landing it here rather
  than as three panes is the point of the recap.

Each row links to the surface that owns it (the project page, the Apps row,
the session), and the recap never becomes a second editor for those
records; it lists and revokes.

**Summary line.** The category opens with one line so a host can tell at a
glance what is shared, in this shape:

```text
3 URL-enabled public grants (1 permanent, 2 temporary, expiring 2m–7d) ·
2 username-gated grants active (1 permanent, 1 temporary, expiring 4h) ·
exposing 2 projects and 4 project templates to limited users
```

- *URL-enabled public grants* count everything reachable by link alone:
  public session shares, app links, artifact links, and Public vhost rows.
- *Username-gated grants* count session guests and project memberships
  held by limited users.
- *Exposing N projects* counts projects with at least one limited-user
  member or guest; *N project templates* counts templates limited users may
  create from ([[project-templates]]).
- Wherever a kind can be either, permanent and temporary are counted
  separately, and the temporary count shows its expiry range from soonest to
  latest (for example `2m–7d`), or a single value when they coincide.
  Kinds that cannot expire show no range.

The category is hidden entirely when no limited user, guest, or bearer
grant exists, in keeping with [[settings-ui-placement]] and
[[vanilla-defaults]].

## Execution boundary

The [[session-sandboxing]] Linux mechanism is the enforcement floor: a
limited user's session is confined to its project tree with the sandbox's
fixed private roots, and cannot be launched unsandboxed or on a non-Linux
host or remote executor until those gain an equivalent boundary. That topic
currently declines to call itself a hostile multi-tenant sandbox; this
proposal does not change that claim by fiat. Before limited users ship, the
sandbox's threat model must be re-read for the case "the person typing the
prompt is not the machine owner", in particular: provider credentials in the
child environment, the project parent directory the user may create into,
shared caches between users' sessions, and `!!` bang commands, which run in
the project directory outside the provider and must run inside the same
sandbox or be refused for limited users.

Sessions of different users on one host share YA's process, event bus, and
data dir. The isolation claim is authorization plus per-session filesystem
confinement, not process-level tenancy; [[security]] should say so in its
trust-boundary section when this lands.

## App access for members and the public

Today an app is reached either by a bearer URL or by the row's explicit
`public` flag; URL possession is the authorization unit
([[active-content-security]]). Members get bearer links for their projects'
apps through the existing links route, filtered by membership. Viewers,
later, get the same links read-only.

Wanting an app open to the public while still knowing who is visiting is a
distinct request: it is about fetching the bundle at all, not the app's own
accounts. It is tracked as
[`gaps/sketches/app-public-access-with-identity.md`](../gaps/sketches/app-public-access-with-identity.md)
rather than decided here.

## Phases

When choosing an implementation shape for these phases, note how it uses or
defers the relevant shared seams from [[principals-and-grants]]: stable
principal identity, authenticated request context, grant and local-policy
enforcement, credential provenance, and revocation. An incremental phase need
not implement every credential source or grant type.

1. **Principals.** Limited-user records, superuser-managed creation and
   reset, username on the direct login page, HTTP Basic for limited users,
   principal attached by middleware. No authorization changes yet, so a
   limited user is refused everywhere until phase 2; the phase is only
   useful as a landing for tests. ‖
2. **Project access.** `project-access.json`, owner and editors, route-family
   checks from the table, members UI, 404 scoping of lists and pages,
   forced sandbox, bang-command refusal or confinement, provider lock and
   stale-session cutoff at create and message routes. ‖
3. **Relay.** Per-user SRP verifiers selected by `srp_hello` identity,
   hosted-client login with a username field, pairing flow update
   ([[mobile-server-pairing]]); no relay redeploy. ‖
4. **Viewers**, **session guests**, and the template-only New Project for
   limited users, plus the Settings → Limited Users grants recap, once
   [[project-templates]] phase 2 exists. Guests may land
   earlier than viewers since their scope is one session and needs no
   project-level filtering beyond a 404 for everything else.

## Open decisions

- Whether relay-side per-user limits justify per-user server sockets, or a
  later relay protocol field carrying the user beside the server name once
  a redeploy is planned for other reasons.
- Per-user settings partition: which browser-local preferences should become
  server-side per-user (theme, session defaults) and whether that is worth a
  fourth settings scope in [[settings-ui-placement]].
- Whether owners may add editors themselves or only the superuser may.
- Whether limited users may use provider accounts of the host at all, or
  must bring their own ([[copilot-provider]] already notes per-user tokens
  for a hosted case).
- Rate limits and session caps per limited user, extending the relay's
  five-session cap.
- Session-continuation authority for guests: when a shared session is
  forked, rewound into a new session, or redirected by the host's own stale
  cutoff, which successor if any the guest may follow into.

## See also

- [[principals-and-grants]] — shared vocabulary and relationship to hosted and
  peer-issued authority.
- [[security]] — current single-user trust boundary this proposal extends.
- [[session-sandboxing]], [[session-sandbox-network-boundary]] — the
  execution floor.
- [[project-templates]] — the only project-creation path for limited users.
- [[active-content-security]], [[relay-origin-and-share-gating]] — bearer
  authority for apps and shares.
- [[mobile-server-pairing]], [[relay-client-mux]] — the relay claim and
  login flow the username field joins.
- [[settings-ui-placement]], [[browser-profile-devices]] — existing settings
  and device scopes.
- [[cross-host-delegation]] — the nearest existing permission-grant design.
