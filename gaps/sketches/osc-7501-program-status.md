# Consume OSC 7501 program status only once a report can reach YA

The Program Status Protocol (OSC 7501, revision 0.3, 2026-10-07,
<https://www.superlogical.com/rex/docs/build/program-status>) lets a program
tell its terminal that it is `idle`, `working` (with optional percent),
`blocked` (`permission` / `question` / `auth`), `done`, or `error`. It
looks like a natural feed for YA's session status, but as of 2026-10-09 no
report reaches YA. Nothing in YA should change yet.

## Why no report arrives

- **Claude Code** 2.1.295 emits it with `app=claude-code`, but only from
  its interactive TUI and only after the terminal answers the
  `OSC 7501 ; ?` probe. YA drives Claude through the SDK with no
  terminal, so Claude never emits it here. YA's provider events already
  carry richer state than the protocol's six values (see
  `topics/provider-runtime-status.md`).
- **Codex** 0.162.0, the latest npm release on 2026-10-09, contains no
  OSC 7501 string.
- **Tool output** (Bash, Codex exec) runs without a terminal that answers
  the probe. Programs that follow the spec, including acli tools in
  `~/agents` (`acli.status`), also write nothing when an agent-session
  marker is set. A program that writes reports unconditionally is already
  harmless: `packages/shared/src/ansi-renderer.ts` and
  `ProviderLoginService`'s output cleaner strip every OSC sequence.

## When to revisit

- A provider emits these reports in a headless or streaming mode, or
  through its event protocol. Map `blocked` onto the existing
  awaiting-input state instead of adding a parallel status.
- YA gains an embedded terminal (a PTY whose output a person watches in
  YA). It would then answer the probe and show `working` / `blocked` /
  `done` on the terminal's tab, the way libghostty does.
- Emitting YA's own aggregate state (for example `blocked` while any
  session awaits approval) to the server's terminal would be novel,
  user-visible behavior, so it would need a default-off option
  (`topics/vanilla-defaults.md`). It would also do nothing under tmux,
  which does not forward unrecognized OSC sequences to the outer terminal
  without explicit passthrough wrapping, and the maintainer's server runs
  in a tmux session.

Found 2026-10-09 while adding OSC 7501 support to the `~/agents` acli
library.
