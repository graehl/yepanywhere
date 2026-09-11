import { mkdir, writeFile, utimes } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

test("automatically discovers Jira and GitHub references from viewed and recent sessions", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const project = join(e2ePaths.tempDir, "mockproject");
  const projectId = Buffer.from(project).toString("base64url");
  const dir = join(
    e2ePaths.claudeSessionsDir,
    hostname(),
    project.replace(/\//g, "-"),
  );
  await mkdir(dir, { recursive: true });
  const headers = {
    "Content-Type": "application/json",
    "X-Yep-Anywhere": "true",
  };
  const settings = async (
    enabled: boolean,
    scope = "viewed",
    recentDays = 7,
  ) => {
    const r = await page.request.put(`${baseURL}/api/issues/settings`, {
      headers,
      data: { enabled, scope, recentDays },
    });
    expect(r.ok()).toBeTruthy();
  };
  const write = async (id: string, text: string, days = 0) => {
    const timestamp = new Date(Date.now() - days * 86400_000);
    const path = join(dir, `${id}.jsonl`);
    await writeFile(
      path,
      `${JSON.stringify({ type: "user", uuid: `${id}-message`, sessionId: id, cwd: project, timestamp: timestamp.toISOString(), message: { role: "user", content: text } })}\n`,
    );
    await utimes(path, timestamp, timestamp);
  };
  await write(
    "issues-view-one",
    "Working on https://jira.example.test/browse/AUTOTEST-123. [Repair cancellation handling](https://github.com/example/engine/pull/42).",
  );
  await write("issues-view-two", "Another conversation about AUTOTEST-123.");
  await write(
    "issues-unopened",
    "Index this unopened session: https://jira.example.test/browse/RECENTTEST-345.",
  );
  await write("issues-old", "Do not index this old session: OLDTEST-999.", 21);
  await page.request.put(`${baseURL}/api/settings`, {
    headers,
    data: { workstreamsEnabled: false },
  });
  await settings(false);
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(`${baseURL}/settings/issues`);
  const skip = page.locator(".onboarding-skip-all");
  if (await skip.isVisible()) await skip.click();
  await expect(
    page.getByLabel("Enable automatic issue discovery (experimental)"),
  ).toBeVisible();
  const scopeBox = await page.getByLabel("Indexing scope").boundingBox();
  expect(scopeBox!.width).toBeGreaterThan(100);
  expect(scopeBox!.x + scopeBox!.width).toBeLessThanOrEqual(1000);
  await page
    .getByLabel("Enable automatic issue discovery (experimental)")
    .check();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`${baseURL}/api/issues/settings`)
          ).json()
        ).settings.enabled,
    )
    .toBe(true);
  try {
    for (const id of ["issues-view-one", "issues-view-two"]) {
      await page.goto(`${baseURL}/projects/${projectId}/sessions/${id}`);
      await expect(
        page.locator("textarea[data-composer-input]").first(),
      ).toBeVisible();
      await expect
        .poll(async () => {
          const result = await (
            await page.request.get(`${baseURL}/api/issues?q=AUTOTEST-123`)
          ).json();
          return result.items?.[0]?.sessionCount ?? 0;
        })
        .toBe(id === "issues-view-one" ? 1 : 2);
    }
    // The session header counts its own associations: the ticket key and the
    // pull request written in this transcript.
    await page.goto(
      `${baseURL}/projects/${projectId}/sessions/issues-view-one`,
    );
    const headerMenu = page.getByRole("button", {
      name: "2 issues and pull requests associated with this session",
    });
    await expect(headerMenu).toBeVisible({ timeout: 30_000 });
    // The header opens a menu of those references rather than leaving the
    // session; each row links at the reference itself.
    await headerMenu.click();
    await expect(
      page.getByRole("menuitem", { name: /AUTOTEST-123/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Show all in this session" }),
    ).toHaveAttribute("href", /\/issues\?sessionId=issues-view-one/);
    await page.keyboard.press("Escape");
    // Resizing dismisses the menu, so each width opens its own before its shot.
    const original = page.viewportSize();
    for (const [name, size] of [
      ["session-issues-menu-desktop", { width: 1200, height: 600 }],
      ["session-issues-menu-phone", { width: 375, height: 812 }],
    ] as const) {
      await page.setViewportSize(size);
      await headerMenu.click();
      await expect(
        page.getByRole("menuitem", { name: /AUTOTEST-123/ }),
      ).toBeVisible();
      await recordUiCapture(page, name);
      await page.keyboard.press("Escape");
    }
    if (original) await page.setViewportSize(original);
    await page.goto(`${baseURL}/issues`);
    const search = page.getByRole("searchbox", {
      name: "Search ticket keys, titles, or paste an issue/PR URL",
    });
    await search.fill("AUTOTEST-123");
    await page
      .getByRole("button", { name: /AUTOTEST-123.*2 sessions/ })
      .click();
    await expect(
      page.getByRole("article", {
        name: "Another conversation about AUTOTEST-123.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "AUTOTEST-123 ↗" }),
    ).toHaveAttribute("href", "https://jira.example.test/browse/AUTOTEST-123");
    await page
      .getByRole("button", { name: "Actions for AUTOTEST-123" })
      .click();
    await page.getByRole("menuitem", { name: "Set display title…" }).click();
    await page
      .getByRole("textbox", { name: "Display title in Yep Anywhere" })
      .fill("Automatic association evidence");
    await page.getByRole("button", { name: "Save title" }).click();
    await search.fill("Automatic association evidence");
    await expect(
      page.getByRole("button", {
        name: /Automatic association evidence.*2 sessions/,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Association actions", exact: true })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Dismiss association" }).click();
    await page.reload();
    await search.fill("AUTOTEST-123");
    await expect(
      page.getByRole("button", { name: /AUTOTEST-123.*1 session/ }),
    ).toBeVisible();
    await page.goto(
      `${baseURL}/projects/${projectId}/sessions/issues-view-two`,
    );
    await expect(
      page.locator("textarea[data-composer-input]").first(),
    ).toBeVisible();
    const after = await (
      await page.request.get(`${baseURL}/api/issues?q=AUTOTEST-123`)
    ).json();
    expect(after.items[0].sessionCount).toBe(1);
    await settings(true, "recent", 7);
    await expect
      .poll(
        async () => {
          const r = await (
            await page.request.get(`${baseURL}/api/issues?q=RECENTTEST-345`)
          ).json();
          return r.items?.length ?? 0;
        },
        { timeout: 45_000 },
      )
      .toBe(1);
    expect(
      (
        await (
          await page.request.get(`${baseURL}/api/issues?q=OLDTEST-999`)
        ).json()
      ).items,
    ).toHaveLength(0);
    await page.goto(`${baseURL}/issues`);
    await search.fill("Repair cancellation");
    await expect(
      page.getByRole("button", { name: /Repair cancellation handling/ }),
    ).toBeVisible();
  } finally {
    await settings(false);
  }
});

test("old servers receive no issue requests and hide issue settings", async ({
  page,
  baseURL,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/issues"))
      requests.push(r.url());
  });
  await page.route("**/api/version*", (route) =>
    route.fulfill({
      json: { current: "0.8.1", capabilities: [], sqlite: { state: "ready" } },
    }),
  );
  await page.goto(`${baseURL}/issues`);
  await expect(
    page.getByText("Issue discovery is disabled or unavailable.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(requests).toEqual([]);
});
