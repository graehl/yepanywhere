import { fetchJSON } from "./sourceApiFetch";

type NotificationSettings = {
  toolApproval: boolean;
  userQuestion: boolean;
  sessionHalted: boolean;
  projectInactive: boolean;
  yaInactive: boolean;
};

export const pushApi = {
  getPushPublicKey: () =>
    fetchJSON<{ publicKey: string }>("/push/vapid-public-key"),

  subscribePush: (
    browserProfileId: string,
    subscription: PushSubscriptionJSON,
    deviceName?: string,
  ) =>
    fetchJSON<{ success: boolean; browserProfileId: string }>(
      "/push/subscribe",
      {
        method: "POST",
        body: JSON.stringify({ browserProfileId, subscription, deviceName }),
      },
    ),

  unsubscribePush: (browserProfileId: string) =>
    fetchJSON<{ success: boolean; browserProfileId: string }>(
      "/push/unsubscribe",
      {
        method: "POST",
        body: JSON.stringify({ browserProfileId }),
      },
    ),

  getPushSubscriptions: () =>
    fetchJSON<{
      count: number;
      subscriptions: Array<{
        browserProfileId: string;
        createdAt: string;
        deviceName?: string;
        endpointDomain: string;
        deviceType: "android" | "ios" | "mobile" | "desktop" | "unknown";
      }>;
    }>("/push/subscriptions"),

  testPush: (
    browserProfileId: string,
    message?: string,
    urgency?: "normal" | "persistent" | "silent",
    deliveryUrgency?: "very-low" | "low" | "normal" | "high",
  ) =>
    fetchJSON<{ success: boolean }>("/push/test", {
      method: "POST",
      body: JSON.stringify({
        browserProfileId,
        message,
        urgency,
        deliveryUrgency,
      }),
    }),

  deletePushSubscription: (browserProfileId: string) =>
    fetchJSON<{ success: boolean }>(
      `/push/subscriptions/${encodeURIComponent(browserProfileId)}`,
      { method: "DELETE" },
    ),
};

export const pushSettingsApi = {
  getNotificationSettings: () =>
    fetchJSON<{
      settings: NotificationSettings;
    }>("/push/settings"),

  updateNotificationSettings: (settings: Partial<NotificationSettings>) =>
    fetchJSON<{
      settings: NotificationSettings;
    }>("/push/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
};
