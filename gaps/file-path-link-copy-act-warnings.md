# FilePathLink copy tests emit React `act(...)` warnings

`packages/client/src/components/__tests__/FilePathLink.test.tsx` emits an
unwrapped-state-update warning in each of its three copy-path tests. The tests
pass, but `CopyTextButton2` updates its copied state after the assertion has
finished, outside React Testing Library's `act(...)` boundary.

Observed 2026-07-20 while running the full workspace suite for the Markdown
preview rich-copy fix. The warned test and component are unchanged from `HEAD`;
the focused Chromium clipboard regression is warning-free. Fix the tests by
awaiting the copied-state update after each click (or otherwise keeping the
whole async interaction inside the testing-library boundary), without
suppressing `console.error`.
