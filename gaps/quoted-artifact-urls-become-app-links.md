# Quoted artifact URLs in tool output become dead app links

Artifact-link discovery treats every artifact-origin URL in tool-result text
as something YA announced. `sessionToolUrls` in
`packages/client/src/lib/sessionVhostApps.ts` accepts any `http(s)` URL whose
host is local or whose path starts with `/a/`. `sessionVhostApp` then
promotes it to an artifact app when `isArtifactLink` matches the origin. The
only exclusion is for source-template placeholders (`${…}` and its encoded
form), which `topics/session-right-pane.md` § Vhost tool URLs documents.

A literal URL quoted from source code passes those checks. An `rg` over the
YA tree printed `packages/client/src/lib/sessionVhostApps.test.ts:122`, which
contains the fixture `http://artifacts.localhost:3400/a/grant/report.html#results`.
The tool row made it a clickable app link, and opening it framed the
artifact server's plain `404 Not Found`, because `grant` is not a minted
token. The same happens to any grant URL that has expired or been revoked,
or that an agent composed by hand instead of receiving it from
`POST /api/artifacts`.

The broken rule is that an artifact app link should name a grant this server
actually issued. Heuristics about the surrounding text ("looks like `rg`
output", "is inside a test file") would only hide this one example. The
likely fix: the server resolves discovered `/a/<token>/` URLs against its
live grants, for example through an authenticated batch check that returns
only live tokens. The client then renders and announces only those, and shows
the rest as plain text. Tokens are bearer secrets, so the check must not
turn into an oracle for unauthenticated callers, and a new route needs the
same supported-server compatibility review as other artifact routes.
Clients talking to an older server would keep today's behavior.

Not fixed in place: it needs a new server route and a discovery contract
change in `topics/session-right-pane.md`, beyond the diagnosis that surfaced
it.

Found 2026-09-25 while diagnosing an empty artifact pane opened from an agent's
source-search output.
