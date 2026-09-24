import { join } from "node:path";
import {
  encodeVersionedServerCapabilities,
  SERVER_CAPABILITIES,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

const projectId = Buffer.from(join(e2ePaths.tempDir, "mockproject")).toString(
  "base64url",
);
const sessionId = "mock-session-001";
test.use({ serviceWorkers: "block" });

test("composer popovers draw over the docked right pane", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const timestamp = new Date().toISOString();
  await page.addInitScript(() => {
    localStorage.setItem("yep-anywhere-session-right-pane-enabled", "true");
  });
  await page.route("**/api/version*", async (route) => {
    const response = await route.fetch();
    const metadata = await response.json();
    await route.fulfill({
      json: {
        ...metadata,
        ...encodeVersionedServerCapabilities(
          [
            ...Object.values(SERVER_CAPABILITIES)
              .filter((capability) =>
                serverHasCapability(metadata, capability.name),
              )
              .map((capability) => capability.name),
            SERVER_CAPABILITIES.vhostAppControl.name,
            SERVER_CAPABILITIES.artifactViewer.name,
            SERVER_CAPABILITIES.vhostBearerAccess.name,
          ],
          "0.8.2",
        ),
        artifactViewer: {
          port: 4402,
          available: true,
          locked: false,
          defaultLocalOrigin: baseURL,
          localOrigin: baseURL,
          vhosts: [{ name: "plan", port: 19432 }],
        },
      },
    });
  });
  await page.route(
    new RegExp(
      `/api/projects/[^/]+/sessions/${sessionId}(?:/metadata)?(?:\\?|$)`,
    ),
    (route) =>
      route.fulfill({
        json: {
          session: {
            id: sessionId,
            projectId,
            provider: "claude",
            title: "Review implementation",
            createdAt: timestamp,
            updatedAt: timestamp,
            ownership: { owner: "self" },
            messageCount: 2,
            contextUsage: {
              inputTokens: 84_000,
              percentage: 42,
              contextWindow: 200_000,
              cacheReadTokens: 80_000,
              cacheCreationTokens: 3_000,
              outputTokens: 1_200,
            },
          },
          ownership: { owner: "self" },
          processState: "idle",
          messages: [
            {
              uuid: "app-call",
              type: "assistant",
              timestamp,
              content: [
                {
                  type: "tool_use",
                  id: "app-tool",
                  name: "Bash",
                  input: { command: "plannotator last" },
                },
              ],
            },
            {
              uuid: "app-result",
              type: "user",
              timestamp,
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "app-tool",
                  content:
                    "Plannotator running at http://localhost:19432/review",
                },
              ],
            },
          ],
        },
      }),
  );
  await page.routeWebSocket("**/api/ws", (socket) => {
    const upstream = socket.connectToServer();
    socket.onMessage((wire) => {
      const frame =
        typeof wire === "string"
          ? JSON.parse(wire)
          : wire[0] === 1
            ? JSON.parse(wire.subarray(1).toString())
            : null;
      if (frame?.type === "subscribe" && frame.channel === "session") {
        socket.send(
          JSON.stringify({
            type: "event",
            subscriptionId: frame.subscriptionId,
            eventId: "0",
            eventType: "connected",
            data: { sessionId, processId: "pane-process", state: "idle" },
          }),
        );
      } else upstream.send(wire);
    });
  });
  await page.route("**/api/artifacts/vhosts/links", (route) =>
    route.fulfill({ json: { tokens: { plan: "test-app-bearer" } } }),
  );
  await page.route("**/api/artifacts/vhosts/plan/listener", (route) =>
    route.fulfill({ json: { token: "observed-listener" } }),
  );
  await page.route("http://plan.localhost:*/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body style="font:16px system-ui;padding:20px;background:#f8fafc;color:#172033"><h1>Plan review</h1></body></html>',
    }),
  );

  await page.setViewportSize({ width: 1200, height: 600 });
  await page.goto(`${baseURL}/projects/${projectId}/sessions/${sessionId}`);
  const skip = page.getByRole("button", { name: "Skip all" });
  if (await skip.isVisible()) await skip.click();
  const pane = page.getByRole("complementary", { name: "Session pane" });
  await page
    .getByRole("link", { name: "plan/review ↗", exact: true })
    .click({ timeout: 30_000 });
  await expect(pane).toBeVisible();

  await page
    .getByRole("button", { name: /Context 42%\. Click for token usage/ })
    .click();
  const popover = page.getByRole("dialog", { name: "Token usage" });
  await expect(popover).toBeVisible();
  const popoverBox = (await popover.boundingBox())!;
  const paneBox = (await pane.boundingBox())!;
  // The indicator sits near the column's right edge, so the popover reaches
  // into the pane; that overlap is what this checks, not a vacuous pass.
  expect(popoverBox.x + popoverBox.width).toBeGreaterThan(paneBox.x + 8);
  expect(
    await popover.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.right - 4, box.top + 8);
      return !!hit && element.contains(hit);
    }),
  ).toBe(true);
  await recordUiCapture(page, "right-pane-context-popover-1200");
});
