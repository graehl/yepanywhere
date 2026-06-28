// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacySettings } from "../storageKeys";

describe("storageKeys migrations", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("does not migrate draft recovery keys", () => {
    localStorage.setItem("draft-message-session-a", "session draft");
    localStorage.setItem("draft-new-session", "new session draft");
    localStorage.setItem("draft-new-session-project-a", "project draft");
    localStorage.setItem("fab-draft", "fab draft");
    localStorage.setItem("fab-prefill", "fab prefill");

    expect(migrateLegacySettings("install-a")).toBe(false);

    expect(localStorage.getItem("draft-message-session-a")).toBe(
      "session draft",
    );
    expect(localStorage.getItem("draft-new-session")).toBe(
      "new session draft",
    );
    expect(localStorage.getItem("draft-new-session-project-a")).toBe(
      "project draft",
    );
    expect(localStorage.getItem("fab-draft")).toBe("fab draft");
    expect(localStorage.getItem("fab-prefill")).toBe("fab prefill");
    expect(localStorage.getItem("yep-anywhere-install-a-draft-session-a")).toBe(
      null,
    );
    expect(
      localStorage.getItem("yep-anywhere-install-a-new-session-draft-project-a"),
    ).toBe(null);
    expect(localStorage.getItem("yep-anywhere-install-a-fab-draft")).toBe(null);
    expect(localStorage.getItem("yep-anywhere-install-a-fab-prefill")).toBe(
      null,
    );
  });
});
