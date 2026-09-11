import { readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { recordUiCapture, presentUiCaptures } from "./support/ui-capture.js";

const statePath = process.env.YA_LIVE_HOST_STATE;
test.skip(
  !statePath,
  "Requires an explicitly isolated live provider-host wrapper",
);
test.afterAll(async () => {
  await presentUiCaptures();
});

test("Codex durable resume, browser reload and original native approval", async ({
  page,
}) => {
  const state = JSON.parse(await readFile(statePath!, "utf8"));
  const { directory, port, projectId, codexSmoke: session } = state;
  const root = resolve("../..");
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Yep-Anywhere": "true" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  const { requestProviderHost } = await import(
    /* @vite-ignore */ `${root}/scripts/provider-runtime-discovery.mjs`
  );
  const descriptor = JSON.parse(
    await readFile(join(directory, "host/host.json"), "utf8"),
  );
  const token = (await readFile(join(directory, "host/token"), "utf8")).trim();
  const runtime = async () => {
    const value = await requestProviderHost(
      {
        controlSocketPath: descriptor.controlSocketPath,
        protocolVersion: 3,
        token,
      },
      { op: "inventory" },
    );
    return (value.runtimes ?? value).find(
      (entry: { sessionId: string }) => entry.sessionId === session.sessionId,
    );
  };
  const restart = async () => {
    const before = await runtime();
    await api("/server/restart", {});
    await expect
      .poll(
        async () => {
          try {
            const current = await runtime();
            return Boolean(
              current?.attachedServerGeneration &&
                current.attachedServerGeneration !==
                  before.attachedServerGeneration,
            );
          } catch {
            return false;
          }
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () => {
          try {
            await api("/dev/status");
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  };
  const progress = join(directory, "project/browser-progress.txt");
  const release = join(directory, "project/browser-release");
  await rm(join(directory, "approval-result.txt"), { force: true });
  await rm(progress, { force: true });
  await rm(release, { force: true });
  const evidence: Record<string, unknown> = {
    host: descriptor.owner,
    sessionId: session.sessionId,
    startedAt: Date.now(),
  };
  const source = join(root, "packages/server/src/routes/dev.ts");
  const original = await readFile(source, "utf8");
  const edited = original.replace(
    "      noBackendReload:",
    '      tactical128Proof: "after-edit",\n      noBackendReload:',
  );
  let sourceEdited = false;
  try {
    await api(`/projects/${projectId}/sessions/${session.sessionId}/resume`, {
      provider: "codex",
      model: "gpt-6-astra",
      effort: "low",
      mode: "bypassPermissions",
      message:
        'Execute this exact shell command once and wait for it to finish; do not create browser-release: i=0; while [ ! -f browser-release ] && [ "$i" -lt 90 ]; do i=$((i+1)); echo "$i" >> browser-progress.txt; sleep 1; done; echo COMPLETE >> browser-progress.txt',
      recapMode: "off",
      promptSuggestionMode: "off",
    });
    await expect
      .poll(() => existsSync(progress), { timeout: 60_000 })
      .toBe(true);
    const before = await runtime();
    evidence.before = before;
    await page.goto(
      `http://127.0.0.1:${port}/projects/${projectId}/sessions/${session.sessionId}`,
    );
    await expect(page.locator("textarea").first()).toBeVisible();
    await page
      .locator("textarea")
      .first()
      .fill("Unsent draft survives browser reload");
    expect(edited).not.toBe(original);
    await writeFile(source, edited);
    sourceEdited = true;
    await expect(page.getByText("Server changed", { exact: true })).toBeVisible(
      { timeout: 15_000 },
    );
    await page
      .getByRole("button", { name: "Reload Server", exact: true })
      .click();
    await expect
      .poll(
        async () => {
          try {
            return (await api("/dev/status")).tactical128Proof;
          } catch {
            return null;
          }
        },
        { timeout: 30_000 },
      )
      .toBe("after-edit");
    const after = await runtime();
    evidence.after = after;
    expect(after.pid).toBe(before.pid);
    expect(after.runtimeId).toBe(before.runtimeId);
    expect(after.attachedServerGeneration).not.toBe(
      before.attachedServerGeneration,
    );
    await writeFile(release, "release");
    await expect
      .poll(
        async () => (await readFile(progress, "utf8")).includes("COMPLETE"),
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect(page.locator("textarea").first()).toHaveValue(
      "Unsent draft survives browser reload",
    );
    await page.locator("textarea").first().fill("");
    evidence.browserReloadAt = Date.now();
    await writeFile(source, original);
    sourceEdited = false;
    await restart();
    await expect
      .poll(
        async () => {
          try {
            return (await api("/dev/status")).backendDirty;
          } catch {
            return true;
          }
        },
        { timeout: 30_000 },
      )
      .toBe(false);
    await api(`/sessions/${session.sessionId}/messages`, {
      mode: "default",
      message: `Request explicit permission to execute this command with escalated sandbox permissions, then execute it: echo APPROVED > ${directory}/approval-result.txt . This is a deliberate approval test; do not use a different tool or path.`,
    });
    await expect
      .poll(
        async () =>
          (await api(`/sessions/${session.sessionId}/pending-input`)).request,
        { timeout: 60_000 },
      )
      .toBeTruthy();
    const requestBefore = (
      await api(`/sessions/${session.sessionId}/pending-input`)
    ).request;
    evidence.approvalBefore = requestBefore;
    const approvalWorker = await runtime();
    await restart();
    await expect
      .poll(
        async () =>
          (await api(`/sessions/${session.sessionId}/pending-input`)).request,
        { timeout: 15_000 },
      )
      .toBeTruthy();
    const requestAfter = (
      await api(`/sessions/${session.sessionId}/pending-input`)
    ).request;
    evidence.approvalAfter = requestAfter;
    await api(`/sessions/${session.sessionId}/input`, {
      requestId: requestAfter.id,
      response: "approve",
    });
    await expect
      .poll(() => existsSync(join(directory, "approval-result.txt")), {
        timeout: 60_000,
      })
      .toBe(true);
    expect((await runtime()).pid).toBe(approvalWorker.pid);
    evidence.outcome = "passed";
    await page.reload();
    for (const viewport of [
      { width: 1000, height: 600 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(
        page.getByText("Server changed", { exact: true }),
      ).not.toBeVisible();
      await expect(page.locator("textarea").first()).toBeVisible();
      await expect(
        page.getByText("Loading session...", { exact: true }),
      ).not.toBeVisible({ timeout: 30_000 });
      await recordUiCapture(
        page,
        `codex-live-reload-${viewport.width}`,
        viewport,
      );
    }
  } finally {
    if (sourceEdited && (await readFile(source, "utf8")) === edited) {
      await writeFile(source, original);
      await api("/server/restart", {}).catch(() => {});
    }
    await writeFile(release, "cleanup");
    await writeFile(
      join(directory, "browser-live.json"),
      JSON.stringify(evidence, null, 2),
    );
  }
});
