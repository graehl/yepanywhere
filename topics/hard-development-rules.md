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

## Applying the Rule

Before changing an affected default or migration path:

- Distinguish existing configured users from new installs with no stored
  preference.
- Preserve existing user choices unless the user explicitly opts into a
  migration.
- State any new default as a product decision, including why it is safe for
  users who have never configured the value.
- Keep personal deploy endpoints, relay choices, and hosted-client conveniences
  in local deploy configuration or private docs.
