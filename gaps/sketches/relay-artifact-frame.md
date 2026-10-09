# Run scripted HTML artifacts over the encrypted relay, without a tunnel

Status: sketch; the Chrome feasibility spike passed on 2026-10-08. Chrome is
the only target for now. Contributing-model: opus-5.5.

## Problem

Agents write HTML reports that load relative images, stylesheets and scripts.
Through the hosted client (yepanywhere.com over the relay) they render without
those assets. The scriptless `srcdoc` preview
(`packages/client/src/lib/scriptlessHtmlPreview.ts`) resolves `../assets/a.png`
against the YA page, for example
`https://latest.yepanywhere.com/-/relay/<host>/assets/a.png`. Its CSP
(`img-src data: blob:`) refuses that address, and the static host could not
answer it anyway. Interactive previews
([interactive HTML artifacts](../../topics/active-content-security.md#interactive-html-artifacts))
and [file vhosts](../../topics/active-content-security.md#file-vhosts) work,
but only after the operator sets up a public HTTPS tunnel to the artifact
listener. Their bytes then bypass the relay's end-to-end encryption. Public
share Play works through the relay, but it inlines only element assets and
publishes a share.

The maintainer wants scripted pages to work over the relay with no tunnel and
no plaintext hop. Making the scriptless preview load assets is not enough, and
serving artifact URLs from a service worker on the hosted YA origin was
rejected: untrusted HTML at a YA-origin URL is only one missing header away
from reading relay resume state.

## Direction

The YA page frames a static **content origin**, which holds only a versioned
bootstrap page and a service worker. The bootstrap registers the worker. The
artifact then loads in an inner frame under the worker's scope, so every
request it makes (documents, CSS, fonts, modules, `fetch()`) reaches the
worker. The worker asks the bootstrap, the bootstrap asks the YA parent over a
`MessagePort`, and the parent reads the file over the existing encrypted relay
and streams it back. The relay sees only ciphertext. The content host serves
only the bootstrap and the worker, never artifact bytes; its network answers
every artifact path with 404. This is the VS Code webview pattern.

The topic's [direct and relay delivery](../../topics/active-content-security.md#direct-and-relay-delivery)
lists two options: a dedicated host behind a relay or broker, or a client
broker into an opaque `srcdoc`. This is a hybrid. The trusted client brokers
every byte over the encrypted connection, as in the second option, and a real
separate origin supplies module resolution, navigation and storage. That
satisfies `topics/interactives.md`'s "no service worker on the hosted YA
client origin": the worker runs on the content origin.

Direct (LAN or Tailscale) YA pages keep the existing artifact origin, which
already works there. This sketch is for the hosted relay client.

## Spike results (Chrome 154.0.8037.98, macOS)

`node research/relay-artifact-frame-spike/spike.mjs` stands up a YA stand-in
origin holding the files and a content origin serving only the bootstrap and
the worker. It then runs Chrome against a same-site content host
(`g1.usercontent.yepanywhere.com`) and a cross-site one
(`g1.yepusercontent.com`). Chrome's host-resolver rules map both to loopback,
so site computation uses the real public suffix list.

| Profile | Content host | Worker registers | Artifact works | Separate process |
| --- | --- | --- | --- | --- |
| Third-party cookies allowed | same-site | yes | yes | only with `Origin-Agent-Cluster: ?1` |
| Third-party cookies allowed | cross-site | yes | yes | yes |
| Third-party cookies blocked | same-site | yes | yes | only with `Origin-Agent-Cluster: ?1` |
| Third-party cookies blocked | cross-site | **no**: "The user denied permission to use Service Worker" | no | — |
| Playwright default context | both | yes | yes | as above |

Wherever the worker registered:

- Everything worked from the parent alone: relative and `../` images,
  `srcset`, CSS `@import` and `url()`, `@font-face` fonts, classic scripts,
  static and dynamic ES module imports, `fetch()` of JSON, and `localStorage`.
  No artifact request reached the content host's network.
- Navigating to a linked page and reloading the inner frame both stayed under
  the worker's control.
- A 32 MiB body streamed through parent → bootstrap → worker with pull
  backpressure at 370–1,140 MiB/s over loopback. That measures the hop
  overhead, not relay throughput.
- After a single worker was stopped (CDP `ServiceWorker.stopWorker`), the next
  request restarted it and found the bootstrap again. A 40-second idle wait did
  not stop the worker, because DevTools was attached, so real idle termination
  is still unobserved.
- One earlier run that called `ServiceWorker.stopAllWorkers` right after
  `ServiceWorker.enable` left the frame controlled, yet its requests went to
  the network (404). It did not recur with a pause before the stop and is
  probably a CDP race. Even so, the content host's network answer for artifact
  paths must be safe, and the design should let a viewer recover from it.

Consequences:

- **Use a same-site content origin.** Cross-site fails whenever third-party
  cookies are blocked, which includes Chrome incognito by default. Same-site
  works in every profile tested.
- **Send `Origin-Agent-Cluster: ?1` on the bootstrap.** Without it, a
  same-site content frame shares the YA page's renderer process, the one
  holding relay keys. With it, Chrome gave the frame its own process, as it
  does for a cross-site frame. The header also disables `document.domain`
  relaxation.
- **Spec gotchas.** Scope the worker to `/v/` with `Service-Worker-Allowed`,
  or move the script under the scope. `navigator.serviceWorker.ready` never
  resolves for the bootstrap, which is outside the scope; wait on the
  registration's worker state instead.

## Design constraints

- **Origin.** Use per-artifact labels under a dedicated same-site parent such
  as `<label>.usercontent.yepanywhere.com`. Derive the label from the server
  and grant so that artifacts from different hosts never share storage. The
  content host must stay static and secret-free.
- **No cookies.** Same-site content can set cookies scoped to
  `yepanywhere.com` (cookie tossing). The hosted client and relay must
  therefore never rely on cookies, and must never treat
  `Sec-Fetch-Site: same-site` as trust. Neither uses cookies today.
- **Only YA pages may embed the bootstrap.** Without this, any site could
  frame the bootstrap and feed it content, hosting phishing pages under
  `yepanywhere.com` or seeding a label's storage. Restrict it with
  `frame-ancestors` naming the hosted YA origins, and have the bootstrap
  accept its `connect` message only from those origins.
- **Grant enforcement in two places.** The parent answers only paths the
  artifact grant admits: the directory or linked-site rules in
  `topics/active-content-security.md`, reusing `GrantStore`. The server
  re-checks on a grant-scoped relay read, so an artifact can never ask its
  parent for arbitrary files.
- **Sandbox.** Frame with `ARTIFACT_SANDBOX` (`allow-scripts
  allow-same-origin allow-downloads`), with no popups or top-level
  navigation. The worker's responses carry the artifact CSP. Root-relative
  paths, history fallback, WebSockets and app backends stay unsupported, as
  they are on the current artifact origin.
- **Embedded only.** A standalone tab on the content origin has no YA parent
  to forward reads, and handing it relay credentials would break the model.
  "Open in new tab" therefore still needs the tunnel or a public share's Play.
- **Hosted CSP.** The hosted CSP's `frame-src` already admits HTTPS
  (`packages/client/vite-plugin-csp.ts`).
- **Shared plumbing.** The streaming pull protocol matches
  `src/lib/streamedDownload.ts`; share it with the
  [relay-streamed viewer media](relay-streamed-viewer-media.md) sketch, which
  also needs Range support for video.

## Open

- Hosting the wildcard label host: Cloudflare Pages has no wildcard custom
  domains, so a Worker route may be needed. Also wildcard TLS and how
  self-hosted hosted-client origins are configured.
- Cleanup of per-label worker registrations, which accumulate one per label.
- Real idle termination and recovery from a network-fallback request.
- Compatibility: a capability for the grant-scoped relay read and a fallback
  to scriptless preview on older servers
  ([hosted compatibility](../../topics/remote-hosted-compatibility.md)).
- Later: carry the read path over a WebRTC data channel to save relay
  bandwidth. The relay already carries WebRTC signaling for device streaming
  (`device_webrtc_offer` and ICE in
  `packages/client/src/lib/connection/RelayProtocol.ts`). Fingerprints must be
  exchanged over the encrypted relay so DTLS remains end to end.

This supersedes the static-preview asset-broker candidate in
[the HTML viewer gap](../html-document-viewer.md) for the relay case.

Found 2026-10-08 while investigating why agent HTML artifacts lose relative
images through yepanywhere.com.
