import { describe, expect, it, vi } from "vitest";
import { createPushRoutes } from "../../src/push/routes.js";
import type { PushService } from "../../src/push/PushService.js";

describe("Push Routes", () => {
  describe("PUT /settings", () => {
    it("accepts inactivity notification settings", async () => {
      const setNotificationSettings = vi.fn(async (updates) => ({
        toolApproval: true,
        userQuestion: true,
        sessionHalted: false,
        projectInactive: updates.projectInactive === true,
        yaInactive: updates.yaInactive === true,
      }));
      const routes = createPushRoutes({
        pushService: {
          setNotificationSettings,
        } as unknown as PushService,
      });

      const response = await routes.request("/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectInactive: true,
          yaInactive: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(setNotificationSettings).toHaveBeenCalledWith({
        projectInactive: true,
        yaInactive: true,
      });
      await expect(response.json()).resolves.toEqual({
        settings: {
          toolApproval: true,
          userQuestion: true,
          sessionHalted: false,
          projectInactive: true,
          yaInactive: true,
        },
      });
    });

    it("ignores unknown and non-boolean settings", async () => {
      const setNotificationSettings = vi.fn(async (updates) => ({
        toolApproval: true,
        userQuestion: true,
        sessionHalted: false,
        projectInactive: updates.projectInactive === true,
        yaInactive: false,
      }));
      const routes = createPushRoutes({
        pushService: {
          setNotificationSettings,
        } as unknown as PushService,
      });

      const response = await routes.request("/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectInactive: true,
          yaInactive: "yes",
          unknownSetting: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(setNotificationSettings).toHaveBeenCalledWith({
        projectInactive: true,
      });
    });

    it("rejects payloads without any valid setting", async () => {
      const setNotificationSettings = vi.fn();
      const routes = createPushRoutes({
        pushService: {
          setNotificationSettings,
        } as unknown as PushService,
      });

      const response = await routes.request("/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yaInactive: "yes",
          unknownSetting: true,
        }),
      });

      expect(response.status).toBe(400);
      expect(setNotificationSettings).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: "At least one valid setting is required",
      });
    });
  });
});
