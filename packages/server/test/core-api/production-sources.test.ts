import { Hono } from "hono";
import { expect, it } from "vitest";
import {
  EMPTY_LIMITED_USER_GRANTS,
  toUrlProjectId,
} from "@yep-anywhere/shared";
import type { SessionCatalogRow } from "../../src/sessions/catalog-types.js";
import {
  type Principal,
  PRINCIPAL_VARIABLE,
} from "../../src/auth/principal.js";
import { productionApiSources } from "../../src/core-api/production-sources.js";
import { CoreApi } from "../../src/core-api/service.js";
import { createV0Routes } from "../../src/routes/v0/index.js";

it("rejects native cross-project collisions before session-wide metadata can hide them", async () => {
  const visible = toUrlProjectId("/work/visible"),
    privateId = toUrlProjectId("/work/private");
  const rows: SessionCatalogRow[] = [visible, privateId].map(
    (projectId, index) => ({
      sessionId: "same-id",
      projectId,
      projectPath: index ? "/work/private" : "/work/visible",
      projectIdentityKey: projectId,
      title: index ? "private title" : "visible title",
      updatedAt: "2026-10-30T00:00:00Z",
      catalogFamily: "claude",
      storeKey: "fixture",
      sourceVersion: "fixture",
      fidelity: "head",
      location: { kind: "file", path: `/unused/${index}` },
    }),
  );
  const sources = productionApiSources({
    scanner: {
      readRetainedProjects: async () => ({
        projects: [],
        complete: true,
        refreshing: false,
      }),
    },
    sessions: {
      read: async () => ({
        rows,
        catalog: {
          catalogEpoch: "fixture",
          catalogGeneration: 1,
          complete: true,
          refreshing: false,
        },
      }),
    },
    metadata: { getMetadata: () => ({ workingProjectId: visible }) },
    sessionState: () => "not-running",
    providers: () => [],
    hiddenProjects: async () => new Set(),
  });
  const app = new Hono<{ Variables: { yaPrincipal: Principal } }>();
  app.use("*", async (c, next) => {
    c.set(PRINCIPAL_VARIABLE, {
      kind: "limited",
      username: "reader",
      grants: { ...EMPTY_LIMITED_USER_GRANTS, viewProjects: [visible] },
      switched: false,
      locked: true,
      via: "direct",
    });
    await next();
  });
  app.route("/v0", createV0Routes(new CoreApi("A", sources)));
  const response = await app.request("/v0/servers/A/sessions");
  expect(response.status).toBe(200);
  expect((await response.json()).items).toEqual([]);
  expect((await app.request("/v0/servers/A/sessions/same-id")).status).toBe(
    404,
  );
});
