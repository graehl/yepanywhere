import { get } from "node:http";
import { stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SUPERUSER } from "../../src/auth/principal.js";
import {
  createAgentApiRuntime,
  type AgentApiRuntime,
} from "../../src/agent-api/runtime.js";
import { CoreApi, CoreApiError } from "../../src/core-api/service.js";

function request(
  runtime: AgentApiRuntime,
  path: string,
  token?: string,
  headers: Record<string, string> = {},
) {
  return new Promise<{
    status: number;
    body: string;
    json: () => ReturnType<typeof JSON.parse>;
  }>((resolve, reject) => {
    const req = get(
      new URL(path, runtime.baseUrl),
      {
        socketPath: runtime.socketPath,
        headers: {
          ...headers,
          ...(token ? { Authorization: token } : {}),
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode!,
            body,
            json: () => JSON.parse(body),
          }),
        );
      },
    );
    req.setTimeout(5000, () =>
      req.destroy(new Error("Fixture HTTP request timed out")),
    );
    req.on("error", reject);
  });
}
const controller = (id: string, name: string) =>
  new CoreApi(id, {
    projects: async () => ({
      items: [{ id: name, name, path: `/fixture/${name}` }],
      catalog: { complete: true, refreshing: false },
    }),
    sessions: async () => ({ items: [] }),
    providers: async () => [],
  });

describe("launch-bound local agent adapter", () => {
  it.each(
    process.platform === "win32"
      ? ["loopback" as const]
      : ["unix" as const, "loopback" as const],
  )(
    "uses real %s HTTP with isolated profiles, credential lifetime and controller replacement",
    async (transport) => {
      let now = 0;
      const a = await createAgentApiRuntime({
        serverId: "A",
        transport,
        now: () => now,
      });
      const b = await createAgentApiRuntime({ serverId: "B", transport });
      try {
        let sessionId: string | null = null;
        const lease = a.issue({
          principal: SUPERUSER,
          sessionId: () => sessionId,
        });
        const token = lease.environment.AGENT_YA_V0_AUTHORIZATION;
        const other = b.issue({
          principal: SUPERUSER,
          sessionId: () => "other",
        });
        for (const path of ["/v0", "/v0/help", "/v0/schema"])
          expect((await request(a, path)).status).toBe(401);
        expect((await request(b, "/v0/me", token)).status).toBe(401);
        expect(
          (
            await request(
              a,
              "/v0/me",
              other.environment.AGENT_YA_V0_AUTHORIZATION,
            )
          ).status,
        ).toBe(401);
        const pending = (await request(a, "/v0/me", token)).json();
        expect(pending.session).toEqual({ id: null, launchId: lease.launchId });
        sessionId = "canonical/session";
        const bound = (
          await request(a, "/v0/me?sessionId=forged", token, {
            "X-Agent-Session-Id": "forged",
          })
        ).json();
        expect(bound.session).toEqual({
          id: sessionId,
          launchId: lease.launchId,
        });
        expect(bound.server.id).toBe("A");
        expect(bound.links.session).toBe(
          "/v0/servers/A/sessions/canonical%2Fsession",
        );
        expect((await request(a, "/api/settings", token)).status).toBe(404);
        expect(
          (
            await request(a, "/v0/help", token, {
              Origin: "https://example.com",
            })
          ).status,
        ).toBe(403);
        expect(
          (await request(a, "/v0/me", token, { Host: "evil.invalid" })).status,
        ).toBe(403);
        expect((await request(a, "/v0/servers/B/projects", token)).status).toBe(
          404,
        );
        expect(
          (await request(a, "/v0/servers/A/projects", token)).json().error.code,
        ).toBe("controller_unavailable");
        const detachOld = a.attachController(controller("A", "old"));
        expect(
          (await request(a, "/v0/servers/A/projects", token)).json().items[0]
            .id,
        ).toBe("old");
        const detachNew = a.attachController(controller("A", "new"));
        detachOld();
        expect(
          (await request(a, "/v0/servers/A/projects", token)).json().items[0]
            .id,
        ).toBe("new");
        detachNew();
        const shared = controller("A", "same-reader");
        const detachSameOld = a.attachController(shared);
        const detachSameNew = a.attachController(shared);
        detachSameOld();
        expect(
          (await request(a, "/v0/servers/A/projects", token)).json().items[0]
            .id,
        ).toBe("same-reader");
        detachSameNew();
        expect((await request(a, "/v0/me", token)).status).toBe(200);
        expect((await request(a, "/v0/help", token)).body).toContain(
          "READ ONLY",
        );
        expect(() => a.attachController(controller("B", "wrong"))).toThrow(
          "identity mismatch",
        );
        now = 24 * 60 * 60 * 1000;
        expect((await request(a, "/v0/me", token)).status).toBe(401);
        lease.renew();
        expect((await request(a, "/v0/me", token)).status).toBe(200);
        lease.dispose();
        lease.renew();
        expect((await request(a, "/v0/me", token)).status).toBe(401);
        const fresh = a.issue({
          principal: SUPERUSER,
          sessionId: () => "fresh",
        });
        a.revokeAll();
        fresh.renew();
        expect(
          (
            await request(
              a,
              "/v0/me",
              fresh.environment.AGENT_YA_V0_AUTHORIZATION,
            )
          ).status,
        ).toBe(401);
        if (a.socketPath)
          expect((await stat(a.socketPath)).mode & 0o777).toBe(0o600);
        else expect(new URL(a.baseUrl).hostname).toBe("127.0.0.1");
      } finally {
        await Promise.all([a.close(), b.close()]);
        if (a.socketPath)
          await expect(stat(a.socketPath)).rejects.toMatchObject({
            code: "ENOENT",
          });
      }
    },
  );

  it.each(["success", "error", "same-reader"])(
    "settles detached reads before the old source resolves (%s)",
    async (outcome) => {
      const runtime = await createAgentApiRuntime({
        serverId: "A",
        transport: "loopback",
      });
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const old = new CoreApi("A", {
        projects: async () => {
          enter();
          await blocked;
          if (outcome === "error")
            throw new CoreApiError(
              "session_not_found",
              "Stale missing observation",
              404,
            );
          return { items: [{ id: "stale", name: "stale", path: "/stale" }] };
        },
        sessions: async () => ({ items: [] }),
        providers: async () => [],
      });
      try {
        const lease = runtime.issue({
          principal: SUPERUSER,
          sessionId: () => "session",
        });
        runtime.attachController(old);
        const reading = request(
          runtime,
          "/v0/servers/A/projects",
          lease.environment.AGENT_YA_V0_AUTHORIZATION,
        );
        await entered;
        runtime.attachController(
          outcome === "same-reader" ? old : controller("A", "replacement"),
        );
        expect((await reading).status).toBe(503);
        // No source release yet: detach itself must free the HTTP waiter.
        expect(
          (
            await request(
              runtime,
              "/v0/me",
              lease.environment.AGENT_YA_V0_AUTHORIZATION,
            )
          ).status,
        ).toBe(200);
      } finally {
        release();
        await runtime.close();
      }
    },
  );

  it("keeps own-context requests usable while detached catalog reads remain unresolved", async () => {
    const runtime = await createAgentApiRuntime({
      serverId: "A",
      transport: "loopback",
    });
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const old = new CoreApi("A", {
      projects: async () => {
        entered();
        await blocked;
        return { items: [] };
      },
      sessions: async () => ({ items: [] }),
      providers: async () => [],
    });
    try {
      const lease = runtime.issue({
        principal: SUPERUSER,
        sessionId: () => "own",
      });
      const detach = runtime.attachController(old);
      const reads = Array.from({ length: 16 }, () =>
        request(
          runtime,
          "/v0/servers/A/projects",
          lease.environment.AGENT_YA_V0_AUTHORIZATION,
        ),
      );
      await started;
      expect(
        (
          await request(
            runtime,
            "/v0/me",
            lease.environment.AGENT_YA_V0_AUTHORIZATION,
          )
        ).status,
      ).toBe(200);
      detach();
      expect(
        (await Promise.all(reads)).every((response) => response.status === 503),
      ).toBe(true);
      expect(
        (
          await request(
            runtime,
            "/v0/me",
            lease.environment.AGENT_YA_V0_AUTHORIZATION,
          )
        ).status,
      ).toBe(200);
    } finally {
      release();
      await runtime.close();
    }
  });
});
