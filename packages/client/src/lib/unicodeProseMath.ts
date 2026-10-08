/**
 * Opt-in typesetting of undelimited math in prose (`ζ(s) = Σ_{n≥1} 1/nˢ`).
 * The server's Markdown renderer marks each recognised region with both
 * its authored text and a hidden KaTeX rendering; this preference only
 * chooses which one is shown, through a root data attribute, so turning it
 * on or off does no per-message work. See topics/rich-text-rendering.md.
 */
import { createLocalStorageBoolean } from "./localStorageValue";
import { UI_KEYS } from "./storageKeys";

export const unicodeProseMathSetting = createLocalStorageBoolean(
  UI_KEYS.unicodeProseMath,
  false,
);

function apply(enabled: boolean): void {
  if (enabled) document.documentElement.dataset.unicodeMath = "on";
  else delete document.documentElement.dataset.unicodeMath;
}

/** Apply the stored preference at boot and follow later changes. */
export function initializeUnicodeProseMath(): void {
  apply(unicodeProseMathSetting.read());
  unicodeProseMathSetting.subscribe(() =>
    apply(unicodeProseMathSetting.read()),
  );
}
