Read and follow `CLAUDE.md` for repo context and instructions.

## Commit Message Guidance

Aim for a <=65 char subject, and strictly enforce a 72-column line wrap
for the body. Prefer bullet lists in the commit body when items are
numerous or complex; prose when the content is short and simple.

**Maintainer**, here, means the human reviewer or a future agent
(possibly you) re-reading this commit to understand or re-derive the
change.

For non-trivial commits, include a concise excerpt or synthesis of the
originating instruction (or motivating observation, when the change
wasn't user-prompted) that is feasible to land in the committed
changes. Summarize the motivating request and key implementation
direction so a Maintainer could paste the message, add their own
adjustments, and recreate something close to the intended result. Prune
digressions, secrets, and low-signal chat detail; do not aim for a
verbatim or exhaustive transcript.

The subject line is the conventional scannable headline result — keep
it scannable in `git log --oneline`. The synthesis lives in the body.
The 72-column body wrap applies to synthesis prose as well.

**Exemption**: skip the synthesis for mechanical or small + self-evident
changes — formatter passes, typo fixes, version bumps, trivial renames
with no substantive user direction. The conventional one-line message
alone is sufficient there.

**Series threading**: when a commit is part of a related series, append
a `Topic: <string>` trailer at the bottom of the body. The topic string
is freeform (descriptive phrasing fine; not constrained to a short
UPPERCASE codename). A series shares the exact same topic string across
all commits — "first in wins": commit-1 sets the canonical text, later
commits copy it verbatim so `git log --grep "Topic: ..."` finds the
chain. Switch topic strings only when it's obviously time for a new
one. Standalone commits with no expected follow-up: no trailer.

To avoid accidentally reusing a topic for an unrelated series, keep a
project-level `topics.md` log at the repo root and append each new
topic string to it when the series begins. The log is appended to
whether or not it's tracked in git. Format is freeform (not a
traditional ChangeLog) — typically a bulleted list with optional
one-line notes. Scan `topics.md` before opening a new series.

## Landing the Plane (Session Completion)

After completing your session, offer proactively, briefly, a suggestion
to the user for what the next logical step in the plan might be, to remind
them of the overall context if this session was a part of a larger implementation plan
