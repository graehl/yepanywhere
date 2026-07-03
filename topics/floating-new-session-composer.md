# Floating New-Session Composer

> The floating new-session composer is YA's non-session-page `+` affordance
> that lets a user type or dictate the first turn in place, preserving page
> context until submit navigates to the New Session flow.

Topic: floating-new-session-composer

Related topics: [mic-button-speech-ui](mic-button-speech-ui.md),
[streaming-speech-capture](streaming-speech-capture.md),
[pluggable-speech-recognition](pluggable-speech-recognition.md),
[session-defaults](session-defaults.md), [vanilla-defaults](vanilla-defaults.md).

## Contract

- The floating `+` is a quick-start surface for non-session views. It stays
  hidden when disabled, when the layout has no safe floating margin, on the New
  Session page, and on session detail pages where it would duplicate the real
  composer.
- Clicking `+` expands an in-place composer. Expansion must not navigate,
  create a provider session, or send a provider turn. Submit is the navigation
  boundary: YA stores the trimmed draft as a source-scoped new-session prefill
  and then navigates to the New Session flow, preserving the current project id
  when the current route carries one.
- The expanded composer's toolbar carries an informational provider+model
  chip (`FloatingComposerModelChip`) resolving the same default seeding the
  New Session form applies (`useDefaultNewSessionModel`). It mounts only
  while expanded so its providers/settings fetch waits for the `+` click,
  and it is display-only — changing the model happens on the New Session
  page this composer submits to.
- The expanded composer may be used with keyboard typing or the shared mic
  button. Speech insertion, selected-span replacement, pending transcription
  tags, spoken commands, and cancellation follow the same
  [mic-button-speech-ui](mic-button-speech-ui.md) contract as the full
  composer; recognized text changes only the floating draft until submit.
- The `+` click is the earliest allowed speculative speech warm trigger. YA
  must not prewarm merely because the floating button rendered, became visible,
  or was approached by the pointer: before the user clicks `+`, a microphone
  indicator would be surprising for a user who only saw a passive page action.
- After the user expands the composer, YA calls the mic button's provider-level
  `prewarm()` hook once for that expansion. The provider boundary owns whether
  anything happens:
  - Browser-native Web Speech has no `prewarm()` implementation. Expansion
    must not call `SpeechRecognition.start()`, enter YA listening state, or
    create a persistent browser recording indicator. This specifically avoids
    seeing a recording icon constantly when the selected ASR backend is
    browser-native.
  - YA-controlled and direct non-browser STT providers may warm resources
    according to [streaming-speech-capture](streaming-speech-capture.md): warm a
    server model, and only hold an idle `MediaStream` when Keep Mic Warm is
    enabled and browser permission is already granted. Any browser mic indicator
    in that case is the existing explicit warm-mic tradeoff, not a side effect
    of browser-native ASR.

## Tests That Should Fail On Contract Regressions

- Expanding the floating composer calls the voice button prewarm hook; merely
  rendering the collapsed `+` does not.
- Browser-native speech provider still has no prewarm hook, so a floating `+`
  expansion cannot start browser-owned speech capture before the mic click.
- Speech recognized through the floating composer mutates only its local draft
  until submit stores the new-session prefill and navigates.
