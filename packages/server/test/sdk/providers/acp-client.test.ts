import { describe, expect, it, vi } from "vitest";
import type { Client } from "@agentclientprotocol/sdk";
import { ACPClient } from "../../../src/sdk/providers/acp/client.js";

function handlersFor(client: ACPClient): Client {
  return (
    client as unknown as {
      createClientHandlers(): Client;
    }
  ).createClientHandlers();
}

describe("ACPClient extension methods", () => {
  it("forwards extension requests to the registered callback", async () => {
    const client = new ACPClient();
    const callback = vi.fn().mockResolvedValue({ outcome: "accepted" });
    client.setExtensionMethodCallback(callback);

    const handlers = handlersFor(client);
    await expect(
      handlers.extMethod?.("x.ai/ask_user_question", {
        sessionId: "session-1",
      }),
    ).resolves.toEqual({ outcome: "accepted" });
    expect(callback).toHaveBeenCalledWith("x.ai/ask_user_question", {
      sessionId: "session-1",
    });
  });

  it("does not claim extension support without a callback", () => {
    const client = new ACPClient();
    expect(handlersFor(client).extMethod).toBeUndefined();
  });
});
