# Emulated Slash Commands

> Emulated slash commands are YA-advertised commands whose submitted text is
> rewritten or routed by YA when the provider has no native command for that
> behavior.

Native provider slash commands win. YA should not shadow a command the provider
advertises; emulation exists to provide a stable user vocabulary across
providers and harnesses when the provider command inventory has a gap.

Default emulation behavior is based on the user-authored skills in
`github.com/graehl/agents`, whose local development checkout may be installed
as the runtime skills directory.

## Contracts

- A slash command entry may carry `emulation.providerText`, declaring the exact
  provider-visible replacement template YA sends when the user submits that
  command. `{{argument}}` is the raw text after the command name.
- Emulation must happen before provider ingress. Initial messages, resumed
  messages, direct queueing, and deferred-promotion paths should all pass
  through the same rewrite/routing layer before provider text is emitted.
- Provider-native commands take precedence. If the provider reports `/wish`,
  `/doubt`, `/rep`, `/harsh-review`, `/goal`, or another native equivalent, YA
  must expose and send the native command unaltered unless a provider-specific
  topic explicitly says otherwise.
- Codex user skills activate through `$skill`, not `/skill`. For Codex-backed
  sessions, YA preserves native/system slash commands such as a leading
  `/goal`, but translates an exact `/name` token to `$name` only when the
  current Codex `skills/list` inventory resolves that installed, enabled skill.
  Unknown slash-shaped text remains literal. The adapter also supplies Codex's
  structured `skill` input item for resolved skills.
- The command menu should distinguish availability from implementation shape.
  A command may be native, provider-text emulated, YA-routed, or unavailable;
  unsupported commands should not silently fall through as ordinary prompt text
  when YA advertised them as commands.
- `argumentHint` and `argumentCompletions` are provider-owned command metadata.
  Completions are non-exhaustive first-argument suggestions, not a validation
  grammar: free-form arguments remain available when the provider accepts them.
  A stopped-session fallback must retain the richest known metadata for each
  provider command rather than replacing live metadata with a name-only row.
- A provider-native local command may return structured YA-local output instead
  of starting a provider turn. YA publishes that output as a synthetic
  `local_command` row for live delivery and short replay, without writing it to
  the provider transcript. Once advertised, such a command must either produce
  its local result or fail visibly; it must never fall through to model text.
- A YA-routed command accepted during an active provider turn may project a
  tagged `ya-command` chip through the canonical queued-message UI until the
  safe local boundary. Routing is decided before provider ingress and carried
  by the tag; YA must never reinterpret arbitrary deferred slash-shaped text by
  content, because the same name may belong to a provider or user skill. The
  boundary consumes the tagged control locally and sends no provider turn.
  `/done` and `/archive` deliberately share one semantic done lane while
  carrying distinct visible command text; this keeps Project Queue and
  automation-pause behavior unified instead of creating another scheduler.
- Immediate YA session operations use the same typed composer resolver but do
  not enter that lane. `/title <text>` saves metadata immediately and bare
  `/title` starts the existing generated-retitle helper. A local operation that
  cannot safely consume the current composer state, such as title with an
  attachment or either Mother-only operation in an aside-routed composer, fails
  visibly and remains recoverable rather than becoming provider text.
- Emulated commands should preserve the user's argument text verbatim except
  for the declared template substitution. Parsing inside the command belongs to
  the skill/provider behavior, not to the generic rewrite layer.

## Design decisions

- **Tag pending YA commands at ingress** (vs. interpreting slash-shaped queued
  text at delivery): explicit routing preserves provider and user skill name
  collisions while allowing YA-local commands to reuse the existing
  server-authoritative queue projection and UI.
- **Attach argument completions to provider commands** (vs. a goal-specific UI
  vocabulary): the provider owns argument semantics, while the composer only
  filters and inserts optional suggestions. Older inventories without the field
  retain the existing command-name completion.

## Codex goal commands

Codex `/goal`, `/goal clear`, `/goal pause`, `/goal resume`, and
`/goal <objective>` are provider-native control operations. YA dispatches them
through `thread/goal/get`, `thread/goal/clear`, and `thread/goal/set`; none may
become model-visible turn text. Setting a new objective while an unfinished
goal exists fails visibly and directs the user to clear it first. Clearing and
then setting a new objective resets the provider goal without falsely marking
the preceding goal complete. Pause and resume results report the status Codex
actually returns, including a preserved usage- or budget-limited state, rather
than echoing the requested transition.

The Codex inventory preserves the original “Keep working toward a verifiable
end state until it is met” description and `<verifiable end state>` free-form
argument hint, and offers `clear`, `pause`, and `resume` as completions.
Interactive `/goal edit` is not advertised because YA has no provider goal
editor; an explicit attempt fails visibly with the supported clear-and-set
route.

## Default Skill Vocabulary

These are the default user-facing fallback commands YA should prefer when a
provider has no native equivalent:

- `/wish <goal>`: pursue a goal until it is verifiably done. On Codex, native
  `/goal` is preferred because the runtime preserves the goal across context
  limits. On Claude, YA may expose `/goal <goal>` as an alias that sends
  `/loop wish <goal>` when Claude reports `/loop` but not `/goal`.
- `/rep ...`: repeat or self-pace a prompt across wakeups. This is ordinary
  command behavior, not a side-session helper.
- `/doubt ...`: run an independent re-check before comparing with the prior
  answer. When YA implements this without provider-native support, it may use
  the shared helper side session from
  [side-session-config.md](side-session-config.md), but independence is an
  instruction to the helper, not a special partial-catch-up mode.
- `/harsh-review ...`: run the stricter structural/correctness review pass.
  This is ordinary command behavior unless a provider later ships an equivalent
  native review command.

## Future Skill Distribution

YA should not silently assume these skills exist in the user's provider
environment. If a provider session lacks the target skill/command, the first
product step is to explain that the command is unavailable and suggest
installing the relevant `github.com/graehl/agents` skill, with a link or
copyable install instruction.

Vendoring is a possible later implementation choice for YA-private use, such
as a side-session `doubt` helper. If YA vendors a skill, keep two concerns
separate:

- User slash-command invocation remains explicit. YA must not cause the user's
  agent harness to run a vendored skill just because matching text appears in
  the conversation; invocation still requires an advertised slash command or a
  YA-owned explicit route.
- A user-installed skill or provider-native command of the same name wins over
  YA's bundled fallback. Vendoring supplies a fallback implementation, not an
  override of the runner's chosen skill version.
- Private helper prompt text can be bundled for YA orchestration, but should
  use the same precedence rule: prefer the user's installed skill when it is
  available and intentionally invoked.

In other words, vendoring must not create accidental non-slash invocation, and
must not replace a user-customized skill of the same name. Native provider
commands still take precedence, and no vendoring work is implied by the current
recap/goal implementation.

## Tests That Should Fail On Contract Regressions

- A YA-advertised emulated command sent as the first message of a new or
  resumed provider session reaches the provider as its expanded/routed form.
- A directly queued or deferred-promoted emulated command reaches the provider
  as its expanded/routed form.
- If a provider advertises a native command with the same name, YA does not
  rewrite that command.
- An advertised but unsupported YA-routed command fails visibly instead of
  being sent to the provider as plain prompt text.
- Provider-native local output reaches both a live subscriber and the replay
  buffer, while the provider receives no user/model turn.
- Provider argument completions filter after an exact command token, insert the
  provider-authored value, and disappear for a complete or free-form argument.
- Stopped Codex sessions preserve the `/goal` objective hint and control
  completions, and every advertised goal control dispatches without a model
  turn.
- Supported `/archive` projects `/archive`; an archive-incapable but done-capable
  server projects `/done` without receiving an archive request. `/title` is
  handled locally and never reaches a provider or focused aside.
