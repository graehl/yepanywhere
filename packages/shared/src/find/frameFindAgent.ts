/**
 * Entry point bundled into the script the artifact server appends to HTML it
 * serves into a YA viewer frame (see scripts/generate-frame-find-agent.mjs).
 * It lets the viewer's find field search this frame only, and turns the
 * frame's own Ctrl+F into a request to open that field.
 */
import { createDocumentFinder, findShortcut } from "./documentFind.js";
import {
  FIND_PROTOCOL,
  type FindReport,
  findSeed,
  isFindRequest,
} from "./protocol.js";

function install(): void {
  const parent = window.parent;
  if (parent === window) return;
  const finder = createDocumentFinder(document, {
    injectHighlightStyle: true,
  });
  const post = (report: FindReport) => parent.postMessage(report, "*");
  window.addEventListener("message", (event) => {
    if (event.source !== parent || !isFindRequest(event.data)) return;
    const request = event.data;
    if (request.type === "hello")
      post({ protocol: FIND_PROTOCOL, type: "ready" });
    else if (request.type === "clear") finder.clear();
    else
      post({
        protocol: FIND_PROTOCOL,
        type: "result",
        seq: request.seq,
        ...(request.type === "find"
          ? finder.find(request.query)
          : finder.step(request.direction)),
      });
  });
  // Bubble phase on window, so an artifact that handles these keys itself
  // (and prevents the default) keeps them.
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    const shortcut = findShortcut(event);
    if (!shortcut) return;
    event.preventDefault();
    post(
      shortcut === "open"
        ? {
            protocol: FIND_PROTOCOL,
            type: "open",
            selection: findSeed(window.getSelection()?.toString()),
          }
        : {
            protocol: FIND_PROTOCOL,
            type: "shortcut",
            direction: shortcut === "next" ? 1 : -1,
          },
    );
  });
  post({ protocol: FIND_PROTOCOL, type: "ready" });
}

install();
