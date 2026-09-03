import {
  CODEX_PAGINATED_ROLLOUT_LINEAGE_CAPABILITY,
  SESSION_FORK_TURN_INTENTS_CAPABILITY,
} from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import {
  getUnifiedSessionForkAvailability,
  supportsUnifiedSessionFork,
} from "../sessionForkAvailability";

describe("supportsUnifiedSessionFork", () => {
  it("requires both the server intent contract and provider primitive", () => {
    const capableServer = {
      capabilities: [SESSION_FORK_TURN_INTENTS_CAPABILITY],
    };
    expect(supportsUnifiedSessionFork(capableServer, true)).toBe(true);
    expect(supportsUnifiedSessionFork(capableServer, false)).toBe(false);
    expect(supportsUnifiedSessionFork({ capabilities: [] }, true)).toBe(false);
    expect(supportsUnifiedSessionFork(undefined, true)).toBe(false);
  });

  it("requires reference-backed history support for Codex providers", () => {
    const oldServer = {
      capabilities: [SESSION_FORK_TURN_INTENTS_CAPABILITY],
    };
    const capableServer = {
      capabilities: [
        SESSION_FORK_TURN_INTENTS_CAPABILITY,
        CODEX_PAGINATED_ROLLOUT_LINEAGE_CAPABILITY,
      ],
    };

    expect(getUnifiedSessionForkAvailability(oldServer, true, "codex")).toEqual(
      {
        available: false,
        reason: "server-missing-codex-lineage",
      },
    );
    expect(supportsUnifiedSessionFork(oldServer, true, "codex-oss")).toBe(
      false,
    );
    expect(supportsUnifiedSessionFork(capableServer, true, "codex")).toBe(true);
    expect(supportsUnifiedSessionFork(oldServer, true, "claude")).toBe(true);
  });

  it("reports the first non-Codex compatibility boundary", () => {
    expect(getUnifiedSessionForkAvailability(undefined, true, "codex")).toEqual(
      {
        available: false,
        reason: "server-missing-fork-intents",
      },
    );
    expect(
      getUnifiedSessionForkAvailability(
        { capabilities: [SESSION_FORK_TURN_INTENTS_CAPABILITY] },
        false,
        "codex",
      ),
    ).toEqual({ available: false, reason: "provider-unsupported" });
  });
});
