import { describe, expect, it } from "vitest";
import { encodeProjectId } from "../src/projects/paths.js";
import { resolveCanonicalProjectRedirect } from "../src/routes/session-project-routing.js";

const draft = encodeProjectId("/local/graehl/trtllm-speculative/draft");
const agents = encodeProjectId("/home/graehl/agents");

describe("resolveCanonicalProjectRedirect", () => {
  it("redirects to the working-project pin from a different request project", () => {
    expect(
      resolveCanonicalProjectRedirect({
        requestProjectId: agents,
        workingProjectId: draft,
        activeProcessProjectId: undefined,
      }),
    ).toBe(draft);
  });

  it("does not bounce away from the pin when a live process runs elsewhere", () => {
    // Regression: pin=draft with a process owned under agents previously
    // ping-ponged draft->agents (process rule) and agents->draft (pin rule),
    // an infinite redirect loop that made the session unviewable.
    expect(
      resolveCanonicalProjectRedirect({
        requestProjectId: draft,
        workingProjectId: draft,
        activeProcessProjectId: agents,
      }),
    ).toBeNull();
    expect(
      resolveCanonicalProjectRedirect({
        requestProjectId: agents,
        workingProjectId: draft,
        activeProcessProjectId: agents,
      }),
    ).toBe(draft);
  });

  it("follows an active process only when there is no pin", () => {
    expect(
      resolveCanonicalProjectRedirect({
        requestProjectId: draft,
        workingProjectId: undefined,
        activeProcessProjectId: agents,
      }),
    ).toBe(agents);
  });

  it("does not redirect when already at the active process project", () => {
    expect(
      resolveCanonicalProjectRedirect({
        requestProjectId: agents,
        workingProjectId: undefined,
        activeProcessProjectId: agents,
      }),
    ).toBeNull();
  });

  it("ignores a non-UrlProjectId active process id", () => {
    expect(
      resolveCanonicalProjectRedirect({
        requestProjectId: draft,
        workingProjectId: undefined,
        activeProcessProjectId: "not a project id",
      }),
    ).toBeNull();
  });

  it("returns null when nothing claims a different canonical project", () => {
    expect(
      resolveCanonicalProjectRedirect({
        requestProjectId: draft,
        workingProjectId: undefined,
        activeProcessProjectId: undefined,
      }),
    ).toBeNull();
  });
});
