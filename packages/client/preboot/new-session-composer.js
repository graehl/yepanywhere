// Pre-boot new-session composer — see topics/early-typing-handoff.md.
//
// Inlined into the app HTML right after #root by
// vite-plugin-preboot-composer.ts, so it runs during parse, before any module
// is fetched. A tab opened on /new-session can be typed into as soon as the
// document arrives instead of after the app has loaded; NewSessionForm adopts
// the text and caret (src/lib/prebootComposer.ts). Keep the inline bundle
// small: every byte here delays first paint of every page.
import { restorePrebootComposer } from "../src/lib/prebootComposer";

(() => {
  if (!/(?:^|\/)new-session\/?$/.test(location.pathname)) return;
  // A prefill arrives with the app; typing ahead of it has no field to go to.
  if (/[?&]prefillToken=/.test(location.search)) return;

  // The same value initializeContentMaxWidth applies once the app loads.
  var contentWidth = Number.parseInt(
    localStorage.getItem("yep-anywhere-content-max-width") || "",
    10,
  );
  if (Number.isFinite(contentWidth)) {
    document.documentElement.style.setProperty(
      "--content-max-width",
      `${Math.min(4000, Math.max(480, contentWidth))}px`,
    );
  }

  // Match NavigationLayout's saved desktop mode and width. Reserving that
  // space keeps the field steady without hiding the reader's sidebar.
  var sidebarWidth = Number.parseInt(
    localStorage.getItem("yep-anywhere-sidebar-width") || "280",
    10,
  );
  sidebarWidth = Number.isFinite(sidebarWidth)
    ? Math.min(560, Math.max(280, sidebarWidth))
    : 280;
  var expanded =
    new URLSearchParams(location.search).get("sidebar") === "expanded" ||
    localStorage.getItem("yep-anywhere-sidebar-expanded") !== "false";
  var minimized =
    !expanded &&
    localStorage.getItem("yep-anywhere-sidebar-minimized") === "true";
  document.documentElement.style.setProperty(
    "--preboot-sidebar-width",
    `${minimized ? 0 : expanded && innerWidth >= sidebarWidth + 600 ? sidebarWidth : 56}px`,
  );

  // Page padding and the project-column gap use rem units. Match the saved
  // UI scale before the app initializes its fonts (default 115%).
  var storedFontScale = localStorage.getItem("yep-anywhere-font-size");
  var legacyFontScales = { small: 85, default: 100, large: 115, larger: 130 };
  var fontScale =
    storedFontScale === null
      ? 115
      : Object.hasOwn(legacyFontScales, storedFontScale)
        ? legacyFontScales[storedFontScale]
        : Number(storedFontScale);
  fontScale = Number.isFinite(fontScale)
    ? Math.min(300, Math.max(50, fontScale))
    : 115;
  document.documentElement.style.setProperty(
    "--preboot-page-padding",
    `${(16 * fontScale) / 100}px`,
  );

  var style = document.createElement("style");
  style.textContent =
    // Above page chrome, below the app's modals (1000+), so a blocking
    // dialog raised at this URL (host offline) still shows over it.
    "#yep-preboot-composer{position:fixed;inset:0;z-index:500;display:flex;" +
    // Roughly where NewSessionForm puts its textarea, so the handoff does not
    // visibly move the text: below the header and prompt label, beside the
    // project panel on wide screens.
    // The page reserves a scrollbar gutter wherever scrollbars take room.
    "align-items:flex-start;padding:95px 18px 18px;overflow-y:auto;" +
    "scrollbar-gutter:stable;" +
    "box-sizing:border-box;background:inherit;color:#e6e6e6;" +
    "font-family:system-ui,-apple-system,sans-serif}" +
    "html[data-theme=light] #yep-preboot-composer{color:#1f1f1f}" +
    "@media (prefers-color-scheme:light){html[data-theme=auto] " +
    "#yep-preboot-composer{color:#1f1f1f}}" +
    "#yep-preboot-composer>div{width:100%}" +
    "@media (min-width:900px){#yep-preboot-composer>div{" +
    "width:calc(100% - 296px)}}" +
    // Wide screens center the page at the reader's content width.
    "@media (min-width:1100px){#yep-preboot-composer{" +
    "left:var(--preboot-sidebar-width);justify-content:center;padding-left:0;padding-right:0}" +
    "#yep-preboot-composer>div{box-sizing:border-box;padding:0 var(--preboot-page-padding);" +
    "width:min(100%,var(--content-max-width,830px))}" +
    "#yep-preboot-composer>div>*{max-width:calc(100% - 280px - var(--preboot-page-padding))}}" +
    "#yep-preboot-composer textarea{display:block;width:100%;" +
    "box-sizing:border-box;padding:.6rem .7rem;border-radius:8px;resize:none;" +
    "font:inherit;font-size:15px;line-height:1.35;color:inherit;" +
    "background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.35);" +
    "outline:none}" +
    "#yep-preboot-composer textarea:focus{border-color:#d97757;" +
    "box-shadow:0 0 0 2px rgba(217,119,87,.15)}" +
    "#yep-preboot-composer p{margin:.4rem .1rem 0;font-size:12px;opacity:.6}";

  var overlay = document.createElement("div");
  overlay.id = "yep-preboot-composer";
  var column = document.createElement("div");
  var textarea = document.createElement("textarea");
  textarea.rows = 6;
  textarea.placeholder = "Describe what you'd like help with...";
  textarea.setAttribute("aria-label", "New session prompt");
  var status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Loading…";

  // On a fine pointer Enter sends in the app. Nothing can be sent yet, and
  // turning the keystroke into a newline would change the text instead.
  var coarse = matchMedia("(pointer: coarse)").matches;
  textarea.addEventListener("keydown", (event) => {
    if (coarse || event.key !== "Enter" || event.isComposing) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    event.preventDefault();
  });

  // A reload before the app adopts this field (a development source-version
  // check, applied browser defaults) must not cost what was typed: keep it
  // in the tab's session storage, where prebootComposer.ts also stashes it.
  restorePrebootComposer(textarea, !import.meta.env.VITE_IS_REMOTE_CLIENT);

  column.append(textarea, status);
  overlay.append(column);
  document.head.append(style);
  document.body.append(overlay);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
})();
