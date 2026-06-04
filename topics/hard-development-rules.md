# Hard Development Rules

> Hard development rules are binding upstream-facing constraints that protect
> user trust, explicit configuration, and operator intent across YA changes.

Topic: hard-development-rules

## Contract

Some development rules are stronger than ordinary implementation preferences:

- They apply before code style, maintainer convenience, or a local deploy's
  current needs.
- They protect user trust, especially where a change could make YA appear to
  reroute traffic, spend money, retain data, weaken privacy, or ignore an
  operator's explicit choice.
- They must be handled as upstream product policy, not as a local maintainer
  preference.

## User Configuration Is Authoritative

Always respect explicit user configuration for relay server, endpoint,
provider, model, and similar deployment-sensitive defaults. Do not silently
replace, override, or repoint configured values with maintainer-local
convenience defaults.

Relay and endpoint defaults are trust-sensitive: changing them can appear to
reroute user traffic onto another operator's infrastructure. An upstreamable
change that alters default relay/server selection, configuration precedence,
environment-variable semantics, hosted-client endpoint selection, or migration
behavior must preserve existing configured values or require a clear opt-in or
migration path.

Maintainer-specific hosted-client publishing choices, such as pointing a
personal Pages build at a personal relay, must stay in local deploy
configuration rather than becoming an upstream default.

## Protocol Compatibility Grace

Hosted Remote Access is a user-facing entry point, so protocol and handshake
changes must roll out as product compatibility changes, not as internal
implementation cleanups.

When a client/server protocol update would make an otherwise valid YA server
stop accepting hosted remote clients, preserve a grace path for the previous
protocol for at least a few weeks whenever basic usage can still be made safe.
During that grace period:

- the hosted remote client should prefer the new protocol but still speak the
  previous protocol;
- the updated YA server may advertise and require the new protocol for its own
  connections;
- users on the previous server protocol must see a visible update warning that
  explains the upcoming cutoff and why the server needs to be updated;
- security hardening may reduce what the fallback can do, such as disabling
  cached resume and requiring a full SRP login, but should not block basic
  connection if the threat model still allows it;
- protocol version fields carry hard compatibility meaning; capability flags
  remain feature hints and must not be the sole basis for a cutoff.

An emergency security cutoff may skip the grace path only with an explicit
documented exception that states the threat, the user impact, and why warning
plus degraded fallback is not acceptable.

## Applying the Rule

Before changing an affected default, protocol, or migration path:

- Distinguish existing configured users from new installs with no stored
  preference.
- Preserve existing user choices unless the user explicitly opts into a
  migration.
- State any new default as a product decision, including why it is safe for
  users who have never configured the value.
- Keep personal deploy endpoints, relay choices, and hosted-client conveniences
  in local deploy configuration or private docs.
- For hosted remote protocol changes, define the previous-protocol grace path,
  warning copy, and planned cutoff condition before landing the enforcement.
