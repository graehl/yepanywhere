import { Hono } from "hono";
import { PRINCIPAL_VARIABLE, type Principal } from "../../auth/principal.js";
import {
  operations,
  API_LAUNCH_VARIABLE,
  type ApiLaunchContext,
} from "../../core-api/contracts.js";
import { type CoreApi, CoreApiError } from "../../core-api/service.js";

/** Mount after the hosting app's authentication and principal resolution. */
export function createV0Routes(api: Pick<CoreApi, "read">) {
  const routes = new Hono<{
    Variables: { yaPrincipal: Principal; yaApiLaunch: ApiLaunchContext };
  }>();
  routes.use("*", async (c, next) => {
    if (!c.get(PRINCIPAL_VARIABLE))
      return c.json(
        { error: { code: "unauthorized", message: "Authentication required" } },
        401,
      );
    c.header("Cache-Control", "no-store");
    await next();
  });
  routes.onError((error, c) => {
    if (error instanceof CoreApiError) {
      if (error.code === "controller_unavailable")
        c.header("Connection", "close");
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    return c.json(
      { error: { code: "internal_error", message: "API read failed" } },
      500,
    );
  });
  for (const operation of operations) {
    routes.get(operation.path || "/", async (c) => {
      const result = await api.read(
        operation.id,
        c.get(PRINCIPAL_VARIABLE) as Principal,
        {
          serverId: c.req.param("serverId"),
          sessionId: c.req.param("sessionId"),
          query: c.req.query(),
          signal: c.req.raw.signal,
          launch: c.get(API_LAUNCH_VARIABLE),
        },
      );
      if (operation.id === "help")
        return c.body(result as string, 200, {
          "Content-Type": "text/markdown; charset=utf-8",
        });
      return c.json(result);
    });
  }
  routes.all("*", (c) =>
    c.json(
      { error: { code: "not_found", message: "Unknown v0 resource" } },
      404,
    ),
  );
  return routes;
}
