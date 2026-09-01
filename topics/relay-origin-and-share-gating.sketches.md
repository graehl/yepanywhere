# Relay Origin And Share Gating Sketches

> Candidate share designs may extend a live transcript from read-only viewing
> into explicitly bounded multiplayer participation without granting ordinary
> YA operator authority.

Topic: relay-origin-and-share-gating

## Participatory Live Share

Status: candidate design, not current guidance.

A participatory live share is a synchronized multi-seat session surface. Its
first implementation has one driver and one guest; v3 generalizes the same
composer and authority model to anonymous N-way participation. It retains the
current driver's ordinary session UI and adds a guest composer immediately
above the driver composer on narrow screens. When the viewport is wide enough,
the two initial composers sit side by side with the driver on the left and
guest on the right, so the distinct authors and their pending text remain
visible together. On the driver's view, each guest composer carries just two
controls: **Steer** and **Queue**. They form a compact vertical column in the
stacked layout and a horizontal row at the guest pane's bottom-right in the
side-by-side layout. Every participant receives the same streaming transcript
state rather than a separate chat transcript or periodically refreshed
snapshot.

The share UI keeps three top-level choices: **Frozen**, **Live**, and
**Multiplayer**. Multiplayer is shown only when the configured participant
limit is greater than one. Its creation form exposes the maximum player count
and one **Send enabled** option rather than multiplying the top-level share
types. With sending disabled, a guest can edit and submit a proposed turn but
cannot mutate the provider session directly. The driver may apply the proposal
with the guest composer's dedicated Steer or Queue control. The ordinary driver
action may also consume the guest proposal when the driver composer is empty;
Shift-click on desktop or long-press on mobile explicitly selects the guest
proposal even when the driver composer contains text. Ordinary activation with
non-empty driver text continues to act on the driver's text.

When **Send enabled** is selected at share creation, each admitted guest may
additionally invoke the bounded send, steer, and queue actions directly. This
authority does not imply approvals, interrupt/restart, session settings, file
access, source control, attachment upload, share management, or creation of
other sessions.

The synchronized state needs server sequencing rather than peer-to-peer
browser convention. At minimum it carries the current guest draft, submitted
proposal identity and revision, whether it has been consumed, and the
resulting provider-input action. Both clients must converge after reconnect;
an older proposal or draft update must not overwrite a newer revision, and one
proposal must not execute twice when driver and guest act concurrently.

### Preferred architecture

Reuse the standard streaming session UI and its send/steer/queue semantics for
both participants, with the server projecting a capability-limited guest
principal and the extra composer stack. This keeps transcript rendering,
session-busy decisions, queued-input behavior, reconnection, and provider
normalization on their existing paths. A focused extension to the current
secure Live Share implementation is also acceptable when it shares those
state/action owners and adds only the synchronized proposal/composer channel;
it must not fork a second session-state machine.

The send-enabled choice is a server-enforced capability recorded on the share,
not merely a control hidden in the guest UI. A current public-share viewer token
is only ephemeral tab identity, and the current bearer-link public transport is
read-only and visible to the relay operator. It cannot silently acquire input
authority. An implementation must therefore define a revocable interactive
grant, bind every mutation to its source session and allowed action set, and
decide whether interactive traffic uses the authenticated encrypted relay path
or a separately encrypted share channel before send-enabled sharing can ship.

### Interaction details to test

- The guest composer remains above the driver composer on narrow screens and
  moves to the right of it when width permits. The driver's two guest actions
  form a vertical Steer/Queue column when stacked and a bottom-right row when
  side by side.
- Driver Send/Steer/Queue with an empty composer consumes the current guest
  proposal; Shift-click on desktop or long-press on mobile consumes it
  deliberately; neither path loses hidden driver text.
- Keyboard and touch users can also choose the guest composer's visible
  Steer/Queue controls rather than depending on an alternate press gesture.
- Guest draft synchronization is distinguishable from submission: typing does
  not execute, and a submitted proposal remains stable while either person
  starts another draft.
- Send-enabled guest input follows the same current-state action rules as the
  ordinary composer and reports acceptance, queue position, rejection, or
  supersession to both participants.
- Revocation immediately removes guest mutation authority while leaving the
  driver session and provider process intact.
- Frozen shares remain immutable and cannot be upgraded in place to an
  interactive grant; the creator chooses an interactive live grant explicitly.

### V2: guest speech recognition

A second implementation pass gives the guest access to YA speech recognition.
Recognized text enters the guest composer and follows the same draft,
submission, send-disabled, and send-enabled rules as typed text.

For YA-mediated recognition, captured audio is also available to the driver as
a separately muteable live stream while recognition is active. Audio presence,
mute state, transcription partials, and final composer text are distinct
synchronized state: muting playback must not stop recognition or discard the
text draft, and reconnect must not replay stale audio as live speech. Direct
browser-to-provider recognition cannot promise the same YA-routed audio stream
unless capture deliberately forks audio into the collaboration channel.

This is v2 because microphone authority, browser playback policy, echo and
feedback prevention, latency, reconnect, retention, provider credentials, and
speech-credit delegation are separate from synchronized text. Current public
shares intentionally cannot spend server speech credits or receive borrowed
speech credentials; an interactive share must add explicit guest speech
authority rather than inherit it from transcript access.

### V3: anonymous N-way participation

V3 generalizes the initial driver-and-guest surface to a configurable
participant limit. The limit defaults to one total active composer seat. Any
value greater than zero streams the driver's in-progress composer content to
ordinary Live Share viewers, while a value greater than one additionally
exposes the Multiplayer share type. A multiplayer share selects a maximum from
two through the configured limit, capped at four in the first release. The
driver occupies one seat; the first `maximum - 1` visitors to join the link
claim the remaining composer seats, and later visitors remain read-only until
a seat is released. The product does not collect or display usernames;
server-generated seat identities exist only to sequence drafts, actions,
reconnects, and revocation.

At up to four active composers, a wide viewport may use a 2×2 grid with the
driver composer fixed at bottom-left. Narrow viewports stack the composers
vertically while retaining the driver/guest distinction and each guest's two
Steer/Queue controls. Seat assignment must not make a reconnecting visitor
overwrite another participant's draft or let two tabs execute through one
seat.

The protocol should not hard-code four even though the first release does. A
future limit above four may use a larger responsive grid; whenever the layout
is not a vertical stack, the driver's composer receives twice the width of a
guest composer. Transcript state remains singular and synchronized across all
participants, while drafts, proposals, speech authority, and action results
remain seat-scoped.

### Open decisions

- Whether one session may have only one participatory share state, like the
  current live projection, or several independently revocable guest grants.
- How long an anonymous seat remains reserved across disconnect, and whether
  the driver may evict one visitor to admit another without revoking the link.
- Whether send-disabled links may use a lighter identity model while still
  preventing proposal spoofing and cross-tab overwrite.
- Whether the driver can temporarily pause guest input without revoking the
  link, and how that paused state appears to both participants.
- Whether guest proposals persist as session-visible collaboration records or
  remain ephemeral UI state after they are consumed or rejected.
