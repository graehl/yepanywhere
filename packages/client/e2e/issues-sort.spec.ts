import { expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

for (const viewport of [
  { width: 1000, height: 600 },
  { width: 375, height: 812 },
]) {
  test(`issue sorting keeps identity, title and activity distinct at ${viewport.width}px`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/settings", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        json: {
          ...body,
          settings: {
            ...body.settings,
            issueAssociations: {
              enabled: true,
              scope: "viewed",
              recentDays: 7,
            },
          },
        },
      });
    });
    const date = (hours: number) =>
      new Date(Date.now() - hours * 3600_000).toISOString();
    const items = [
      {
        id: "jira:site:TF-1295",
        key: "TF-1295",
        title: "Keep the session connected while switching projects",
        provider: "jira",
        kind: "issue",
        sessionCount: 3,
        lastSessionActivityAt: date(2),
        lastMentionAt: date(48),
      },
      {
        id: "github:example/engine:10",
        key: "example/engine#10",
        title: "Improve connection recovery",
        provider: "github",
        kind: "pr",
        sessionCount: 2,
        lastSessionActivityAt: date(6),
        lastMentionAt: date(1),
      },
      {
        id: "jira:site:TF-9",
        key: "TF-9",
        title: null,
        provider: "jira",
        kind: "issue",
        sessionCount: 1,
        lastSessionActivityAt: date(24),
        lastMentionAt: date(12),
      },
      {
        id: "github:example/engine:100",
        key: "example/engine#100",
        title: "Handle missing activity timestamps",
        provider: "github",
        kind: "issue",
        sessionCount: 1,
        lastSessionActivityAt: null,
        lastMentionAt: null,
      },
    ].map((item) => ({
      ...item,
      url: "https://example.test/issue",
      unresolved: false,
    }));
    const orders = {
      key: [2, 0, 1, 3],
      activity: [0, 1, 2, 3],
      mentioned: [1, 2, 0, 3],
      number: [1, 3, 2, 0],
    };
    const requests: Array<{ sort: string; offset: number }> = [];
    await page.route("**/api/issues?*", async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const sort = (params.get("sort") ?? "key") as keyof typeof orders;
      const offset = Number(params.get("offset"));
      requests.push({ sort, offset });
      if (sort === "number")
        await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({
        json: {
          supportedSorts: ["activity", "mentioned", "number"],
          sort,
          items: offset
            ? [{ ...items[2], id: "jira:site:TF-99", key: "TF-99" }]
            : orders[sort].map((i) => items[i]),
          nextOffset: offset ? null : 50,
          coverage: {
            settings: { enabled: true, scope: "viewed", recentDays: 7 },
            active: false,
            error: null,
            counts: [],
          },
        },
      });
    });
    await page.goto(`${baseURL}/issues`);
    const sort = page.getByRole("combobox", { name: "Sort issues & PRs" });
    await expect(sort).toHaveValue("activity");
    const results = page.getByRole("region", { name: "Issue search results" });
    const selectedRows = results.locator("button[aria-pressed]");
    await expect(selectedRows.first()).toContainText("TF-1295");
    await expect(selectedRows.first()).toContainText("Session active 2h ago");
    await expect(results.getByText("Jira", { exact: true })).toHaveCount(2);
    await expect(results.getByText("GitHub PR", { exact: true })).toHaveCount(
      1,
    );
    await expect(
      results.getByText("GitHub issue", { exact: true }),
    ).toHaveCount(1);
    await expect(
      results.getByText("Activity time unavailable", { exact: true }),
    ).toHaveCount(1);
    await recordUiCapture(
      page,
      `issues-sort-activity-${viewport.width}`,
      viewport,
    );
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(selectedRows.first()).toContainText("TF-99");
    await sort.selectOption("mentioned");
    await expect(selectedRows.first()).toContainText("example/engine#10");
    await expect(selectedRows.first()).toContainText("Mentioned 1h ago");
    expect(requests.at(-1)).toEqual({ sort: "mentioned", offset: 0 });
    await sort.selectOption("number");
    await expect.poll(() => requests.at(-1)?.sort).toBe("number");
    // A late response for an abandoned order must not overwrite the new one.
    await sort.selectOption("activity");
    await expect(selectedRows.first()).toContainText("TF-1295");
    await page.waitForTimeout(350);
    await expect(selectedRows.first()).toContainText("TF-1295");
    await sort.selectOption("number");
    await expect(selectedRows.first()).toContainText("example/engine#10");
    await expect(selectedRows.nth(1)).toContainText("example/engine#100");
    await expect(selectedRows.nth(2)).toContainText("TF-9");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    const hues = await results
      .getByText(/^(Jira|GitHub PR|GitHub issue)$/)
      .evaluateAll((nodes) =>
        nodes.map((n) => getComputedStyle(n).backgroundColor),
      );
    expect(new Set(hues).size).toBe(3);
    expect(requests[0]).toEqual({ sort: "key", offset: 0 });
    await page.emulateMedia({ colorScheme: "dark" });
    await recordUiCapture(
      page,
      `issues-sort-number-dark-${viewport.width}`,
      viewport,
    );
  });
}
