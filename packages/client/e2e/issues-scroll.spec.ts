import { expect, test } from "./fixtures.js";

for (const viewport of [
  { width: 1000, height: 600 },
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
]) {
  test(`issue results, pagination and long evidence scroll at ${viewport.width}px`, async ({
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
    await page.route("**/api/issues?*", (route) => {
      const offset = Number(
        new URL(route.request().url()).searchParams.get("offset"),
      );
      return route.fulfill({
        json: {
          items: Array.from({ length: offset ? 1 : 50 }, (_, i) => ({
            id: `issue-${offset + i + 1}`,
            key: `SCROLL-${offset + i + 1}`,
            title: null,
            url: `https://jira.example.test/browse/SCROLL-${offset + i + 1}`,
            provider: "jira",
            kind: "issue",
            sessionCount: 1,
            unresolved: false,
          })),
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
    await page.route("**/api/issues/sessions?*", (route) =>
      route.fulfill({
        json: {
          sessions: [
            {
              sessionId: "scroll-session",
              projectId: "scroll-project",
              title: "A session with many mentions",
              state: "discovered",
              sourceAvailable: false,
              evidenceCount: 80,
              evidence: [
                {
                  id: 0,
                  sessionId: "scroll-session",
                  projectId: "scroll-project",
                  messageId: "first",
                  excerpt: "The first mention",
                  value: "SCROLL-51",
                  kind: "message-url",
                  observedAt: 1789000000000,
                  sourceTime: null,
                  state: "discovered",
                },
              ],
            },
          ],
          nextOffset: null,
        },
      }),
    );
    await page.route("**/api/issues/evidence?*", (route) =>
      route.fulfill({
        json: {
          evidence: Array.from({ length: 30 }, (_, i) => ({
            id: i + 1,
            sessionId: "scroll-session",
            projectId: "scroll-project",
            messageId: `message-${i}`,
            excerpt: `Evidence ${i + 1}: A saved discussion mentioning this ticket. ${"More context from the session. ".repeat(8)}`,
            value: "SCROLL-51",
            kind: "url",
            observedAt: 1789000000000,
            sourceTime: null,
            sourceAvailable: false,
            state: "discovered",
          })),
          nextOffset: 30,
        },
      }),
    );
    await page.goto(`${baseURL}/issues`);
    const results = page.getByRole("region", { name: "Issue search results" });
    await expect(
      results.getByRole("button", { name: /^SCROLL-50 / }),
    ).toBeVisible();
    const content = page.getByRole("main");
    const header = page.getByRole("banner");
    const next = results.getByRole("button", { name: "Next", exact: true });
    await expect(next).not.toBeInViewport();
    // Real wheel input must move content; programmatic scrollIntoView alone can
    // move overflow:hidden boxes and would miss this regression.
    await content.hover({ position: { x: 100, y: 180 } });
    await page.mouse.wheel(0, 20_000);
    await expect(next).toBeInViewport();
    await expect(header).toBeInViewport();
    await next.click();
    const lastIssue = results.getByRole("button", { name: /^SCROLL-51 / });
    await expect(lastIssue).toBeInViewport();
    await lastIssue.click();
    await page.getByRole("button", { name: "Show 79 more mentions" }).click();
    const more = page.getByRole("button", {
      name: "More evidence",
      exact: true,
    });
    await expect(more).toBeVisible();
    await expect(more).not.toBeInViewport();
    await content.hover({ position: { x: 100, y: 180 } });
    await page.mouse.wheel(0, 50_000);
    await expect(more).toBeInViewport();
    await expect(page.getByText(/^Evidence 30:/)).toBeInViewport();
    await expect(header).toBeInViewport();
    await page.mouse.wheel(0, -50_000);
    await expect(page.getByRole("searchbox")).toBeInViewport();
  });
}
