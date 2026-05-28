# Yep Anywhere Relay

A WebSocket pair-matcher that lets a yep-anywhere server behind NAT
accept browser clients without port forwarding, Tailscale, or a VPN.
The relay does **not** see message contents: clients and the
yep-anywhere server complete SRP-6a + NaCl (XSalsa20-Poly1305)
end-to-end, and the relay only forwards opaque frames.

The publicly hosted relay is `wss://relay.yepanywhere.com/ws`. Most
operators do not need to self-host. Reasons to run your own:

- You want a relay you control end to end.
- You want to keep connection metadata (which usernames are online,
  timing, frame sizes) off third-party infrastructure.
- You want the relay to remain available if the public one is
  withdrawn.

## What the process does and does not do

Does:

- Tracks one waiting yep-anywhere server per registered username.
- Pairs an incoming client with the matching waiting server and
  forwards frames between them, preserving binary vs. text framing.
- Persists username ownership (`username` → `installId`) in SQLite
  with first-come-first-served registration and configurable
  inactivity reclamation.
- Exposes `/health`, `/status`, `/stats`, `/online/:username`.

Does not:

- Read, decrypt, or modify message payloads.
- Hold the user's password, SRP verifier, or any per-user secret.
  Those live on the yep-anywhere server, never on the relay.
- Terminate TLS. The process listens plain WS/HTTP. TLS must be
  terminated by a reverse proxy in front of it.

## Running

```bash
pnpm --filter @yep-anywhere/relay build
node packages/relay/dist/index.js
```

Defaults: listens on `:4400`, state in `~/.yep-relay/`.

## TLS is effectively required

Browsers refuse `ws://` from an `https://` page (mixed-content
blocking), so any client coming from the public website or another
HTTPS page must use `wss://`. Even setting that aside, TLS to the
relay matters for two reasons:

1. The `server_register` and `client_connect` envelopes (containing
   the username) are JSON in cleartext on the wire **before** the
   encrypted session is established. TLS hides them from on-path
   observers; without it, anyone in path knows who is connecting.
2. SRP-6a resists offline dictionary attack on the verifier, but
   an active MITM can attempt online password guesses at relay
   speed. TLS to a trusted reverse proxy lets the proxy rate-limit
   guessing; plain `ws://` does not. The SRP password gives full
   remote control of your yep-anywhere server, so the cost of a
   successful guess is high.

Run the relay behind nginx, Caddy, or Cloudflare doing TLS. A Caddy
example:

```caddy
relay.example.com {
  reverse_proxy 127.0.0.1:4400
}
```

Caddy adds `X-Forwarded-For` automatically. For nginx, set it
explicitly:

```nginx
location / {
  proxy_pass http://127.0.0.1:4400;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 3600s;
}
```

## Trust the proxy's X-Forwarded-For

The relay's per-IP unauthenticated-connection cap sees the **direct
peer**. Behind a reverse proxy that peer is the proxy and the cap
collapses into a single global counter unless you tell the relay
which peers to trust.

Set `RELAY_TRUSTED_PROXIES` to a comma-separated list of IPs or
CIDRs whose `X-Forwarded-For` header the relay should honor:

```bash
RELAY_TRUSTED_PROXIES=127.0.0.1,::1
```

The relay walks the header rightmost-to-leftmost, skipping entries
that are themselves in the trusted list, and uses the first
non-trusted entry as the client IP. If unset, the relay uses only
the direct peer.

Do **not** set this to a public range. An attacker who can reach
the relay directly while spoofing `X-Forwarded-For` would otherwise
impersonate any source IP, defeating the per-IP cap entirely.

## Environment variables

| Variable | Default | Effect |
|----------|---------|--------|
| `RELAY_PORT` | `4400` | TCP port to listen on. |
| `RELAY_DATA_DIR` | `~/.yep-relay` | SQLite registry, logs, telemetry. |
| `RELAY_TRUSTED_PROXIES` | empty | IPs/CIDRs whose `X-Forwarded-For` is trusted (see above). |
| `RELAY_RECLAIM_DAYS` | `90` | Days of inactivity before another `installId` can claim a username. |
| `RELAY_UNAUTHENTICATED_CONNECTION_LIMIT_PER_IP` | `10` | Pre-handshake connections per source IP. `0` disables. |
| `RELAY_UNAUTHENTICATED_CONNECTION_TIMEOUT_MS` | `30000` | Time a connection has to send a valid protocol frame before being closed. |
| `RELAY_PING_INTERVAL_MS` | `60000` | Ping interval for waiting connections (paired connections rely on the encrypted protocol's own keep-alive). |
| `RELAY_PONG_TIMEOUT_MS` | `30000` | Drop a waiting connection if no pong within this window. |
| `RELAY_LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`. |
| `RELAY_TELEMETRY_ENABLED` | `true` | Periodic samples + event log under `{dataDir}/telemetry/`. |

## HTTP endpoints

- `GET /health` — `{ status, uptime, waiting, pairs }`.
- `GET /status` — adds memory, registered count, and the list of
  active server registrations including username and `installId`.
- `GET /stats` — HTML rendering of telemetry samples.
- `GET /online/:username` — `{ online: boolean }`. Used by the
  client to check whether the user's yep-anywhere server is
  currently waiting.

`/status` and `/stats` reveal which usernames are registered and
connected. If you do not want this enumeration to be world-readable,
gate those paths with HTTP auth or an IP allow-list in your reverse
proxy.

## Data directory

```
~/.yep-relay/
├── registry.db        # SQLite: username → installId, timestamps
├── logs/relay.log     # if RELAY_LOG_TO_FILE
└── telemetry/         # if RELAY_TELEMETRY_ENABLED
```

`chmod 700 ~/.yep-relay` on a shared host. The SQLite file is not
sensitive in the cryptographic sense — it holds usernames and
opaque `installId` strings, not secrets — but other local users do
not need to read it.

## On the Node.js runtime

Node + npm carries real supply-chain and runtime-attack surface — this
process pulls in `ws`, `hono`, `better-sqlite3`, `pino`, and their
transitive trees. For something that holds nothing but a username
table and forwards opaque frames between paired sockets, that is more
trusted code than the design strictly needs.

A rewrite in Rust or Go would shed most of that: a few hundred lines
of WebSocket framing, a single SQLite touchpoint, an HTTP router for
four endpoints, the trusted-proxy IP logic above. Performance is not
the motivation — the hot path is `socket → socket` byte copy and the
workload is small — but a smaller TCB, a single statically-linked
binary, and an easier-to-audit dependency tree are. The protocol on
the wire is plain WS + small JSON envelopes followed by opaque framed
traffic, so a reimplementation is well-scoped and would not require
any client- or yep-anywhere-server-side change.

If you self-host and want to minimize the trusted footprint, this is
a viable direction. The Node implementation is the reference, not a
long-term commitment.

## Design

See `docs/project/relay-design.md` for the full protocol and crypto
design. This README is the operator's view; the design doc is the
contract.
