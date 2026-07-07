import { describe, expect, it } from "vitest";
import { getRelayCanonicalRedirectTarget } from "../remoteRoutePaths";

describe("getRelayCanonicalRedirectTarget", () => {
  it("redirects direct app routes into the active relay namespace", () => {
    expect(
      getRelayCanonicalRedirectTarget(
        {
          pathname: "/projects",
          search: "?queueItem=item-1",
          hash: "#top",
        },
        "macbook",
      ),
    ).toBe("/macbook/projects?queueItem=item-1#top");
  });

  it("redirects the direct index route to relay projects", () => {
    expect(
      getRelayCanonicalRedirectTarget({ pathname: "/" }, "macbook"),
    ).toBe("/macbook/projects");
  });

  it("does not redirect routes already under the relay namespace", () => {
    expect(
      getRelayCanonicalRedirectTarget(
        { pathname: "/macbook/projects" },
        "macbook",
      ),
    ).toBe(null);
  });

  it("does not redirect when no relay host is active", () => {
    expect(
      getRelayCanonicalRedirectTarget({ pathname: "/projects" }, null),
    ).toBe(null);
  });
});
