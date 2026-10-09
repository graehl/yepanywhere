import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  restorePrebootComposer,
  takePrebootComposer,
  retirePrebootComposer,
} from "../prebootComposer";

function openPreboot(localClient = true) {
  document.body.innerHTML =
    '<div id="yep-preboot-composer"><textarea></textarea></div>';
  const textarea = document.querySelector("textarea")!;
  restorePrebootComposer(textarea, localClient);
  return textarea;
}

describe("preboot draft restoration", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState(null, "", "/new-session");
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("shows the current account's saved draft and preserves its identity for adoption", () => {
    localStorage.setItem("draft-owner:local", "alice");
    localStorage.setItem(
      "draft-account:alice:draft-new-session:local",
      JSON.stringify({ version: 1, text: "Saved prompt" }),
    );
    const textarea = openPreboot();
    expect(textarea.value).toBe("Saved prompt");
    textarea.value += " edited";
    textarea.dispatchEvent(new Event("input"));
    expect(takePrebootComposer()).toMatchObject({
      text: "Saved prompt edited",
      draftKey: "draft-account:alice:draft-new-session:local",
    });
    expect(takePrebootComposer()).toBeNull();
  });

  it("keeps an intentional deletion through reload and retirement", () => {
    localStorage.setItem("draft-new-session:local", "Saved prompt");
    const textarea = openPreboot();
    expect(textarea.value).toBe("Saved prompt");
    textarea.value = "";
    textarea.dispatchEvent(new Event("input"));
    expect(openPreboot().value).toBe("");
    expect(openPreboot().value).toBe("");
    retirePrebootComposer();
    expect(takePrebootComposer()).toMatchObject({
      text: "",
      draftKey: "draft-new-session:local",
    });
  });

  it("does not restore a different account's stash or unscoped draft", () => {
    localStorage.setItem("draft-new-session:local", "Unscoped private text");
    localStorage.setItem("draft-owner:local", "alice");
    localStorage.setItem(
      "draft-account:alice:draft-new-session:local",
      "Alice text",
    );
    const textarea = openPreboot();
    textarea.dispatchEvent(new Event("input"));
    localStorage.setItem("draft-owner:local", "bob");
    expect(openPreboot().value).toBe("");
    expect(takePrebootComposer()?.draftKey).toBe(
      "draft-account:bob:draft-new-session:local",
    );
  });

  it("does not show a local draft in a remote client", () => {
    localStorage.setItem("draft-new-session:local", "Local private text");
    expect(openPreboot(false).value).toBe("");
    expect(takePrebootComposer()?.draftKey).toBeUndefined();
  });

  it("does not restore local text for a nested host route", () => {
    history.replaceState(null, "", "/host/example/new-session");
    localStorage.setItem("draft-new-session:local", "Local private text");
    expect(openPreboot().value).toBe("");
    expect(takePrebootComposer()?.draftKey).toBeUndefined();
  });

  it("keeps an untouched snapshot distinguishable from user edits after reload", () => {
    localStorage.setItem("draft-new-session:local", "Saved prompt");
    openPreboot();
    openPreboot();
    expect(takePrebootComposer()).toMatchObject({
      text: "Saved prompt",
      edited: false,
    });
  });

  it("retains early text when remote identity was not yet known", () => {
    sessionStorage.setItem("yep-preboot-composer-text", "Early text");
    expect(openPreboot(false).value).toBe("Early text");
    expect(takePrebootComposer()).toMatchObject({
      text: "Early text",
      draftKey: undefined,
    });
  });
});
