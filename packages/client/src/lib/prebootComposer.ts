/**
 * The pre-boot new-session composer, seen from the app.
 *
 * `preboot/new-session-composer.js` puts a focused textarea on screen while
 * the HTML is still parsing, so a tab opened on /new-session is typeable
 * before any module loads. The app either adopts it — NewSessionForm takes
 * its text and caret in the commit that creates the real composer — or, when
 * the route resolves somewhere else first (a login redirect), retires it and
 * keeps what was typed for the composer that mounts after sign-in. The
 * overlay itself keeps its text in the same session-storage stash while it is
 * typed into, so a reload before adoption restores it.
 * See topics/early-typing-handoff.md.
 */

import { accountDraftStorageKey } from "./draftAccountStorage";
import { readDraftTextValue } from "./draftEnvelope";

const OVERLAY_ID = "yep-preboot-composer";
const STASH_KEY = "yep-preboot-composer-text";
const STASH_CONTEXT_KEY = "yep-preboot-composer-context";

export interface PrebootComposerText {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  /** Present when the field already showed this account's saved draft. */
  draftKey?: string;
  edited: boolean;
}

/** Restore the local draft before app modules load; remote identity is not known yet. */
export function restorePrebootComposer(
  textarea: HTMLTextAreaElement,
  localClient: boolean,
): void {
  try {
    const draftKey =
      localClient && /^\/new-session\/?$/.test(location.pathname)
        ? accountDraftStorageKey(
            "draft-new-session:local",
            localStorage.getItem("draft-owner:local"),
          )
        : undefined;
    const stash = readStash();
    if (stash && (!stash.draftKey || stash.draftKey === draftKey)) {
      textarea.value = stash.text;
      if (stash.draftKey) textarea.dataset.draftKey = stash.draftKey;
      textarea.dataset.prebootEdited = String(stash.edited);
    } else if (draftKey) {
      textarea.value = readDraftTextValue(localStorage.getItem(draftKey));
      textarea.dataset.draftKey = draftKey;
    }
  } catch {
    // Browser storage can be unavailable; early typing still works.
  }
  stashComposer(readTextarea(textarea));
  textarea.addEventListener("input", () => {
    textarea.dataset.prebootEdited = "true";
    stashComposer(readTextarea(textarea));
  });
}

function readTextarea(textarea: HTMLTextAreaElement): PrebootComposerText {
  return {
    text: textarea.value,
    selectionStart: textarea.selectionStart,
    selectionEnd: textarea.selectionEnd,
    draftKey: textarea.dataset.draftKey,
    edited: textarea.dataset.prebootEdited === "true",
  };
}

function stashComposer(value: PrebootComposerText): void {
  try {
    sessionStorage.setItem(STASH_KEY, value.text);
    sessionStorage.setItem(
      STASH_CONTEXT_KEY,
      JSON.stringify({ draftKey: value.draftKey, edited: value.edited }),
    );
  } catch {
    // Storage unavailable: live adoption still holds the text.
  }
}

/** True when this pathname is the route the pre-boot composer stands in for. */
export function isNewSessionPathname(pathname: string): boolean {
  return /(?:^|\/)new-session\/?$/.test(pathname);
}

function removeOverlay(): PrebootComposerText | null {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return null;
  const textarea = overlay.querySelector("textarea");
  overlay.remove();
  if (!textarea) return null;
  return readTextarea(textarea);
}

function readStash(): PrebootComposerText | null {
  try {
    const text = sessionStorage.getItem(STASH_KEY);
    const context = sessionStorage.getItem(STASH_CONTEXT_KEY);
    sessionStorage.removeItem(STASH_KEY);
    sessionStorage.removeItem(STASH_CONTEXT_KEY);
    const parsed = context ? JSON.parse(context) : null;
    const draftKey =
      typeof parsed?.draftKey === "string" ? parsed.draftKey : undefined;
    const edited = parsed?.edited !== false;
    return text === null
      ? null
      : {
          text,
          selectionStart: text.length,
          selectionEnd: text.length,
          draftKey,
          edited,
        };
  } catch {
    return null;
  }
}

/**
 * Remove the pre-boot composer and hand over what it holds: the overlay's
 * text and caret, or text stashed when it was retired earlier. Null when
 * there is nothing to adopt.
 */
export function takePrebootComposer(): PrebootComposerText | null {
  const live = removeOverlay();
  // The overlay keeps its text in the stash while typed into, so a live
  // overlay already shows it; read it either way so it is adopted once.
  const stash = readStash();
  if (live) return live;
  return stash;
}

/**
 * The app is showing something other than the new-session composer. Get the
 * overlay out of its way and keep any typed text for a later adoption in this
 * tab.
 */
export function retirePrebootComposer(): void {
  const taken = removeOverlay();
  if (taken) stashComposer(taken);
}
