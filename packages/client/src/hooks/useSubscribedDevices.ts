import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useBackgroundRevalidation } from "./useBackgroundRevalidation";

/**
 * Window event fired when this browser's push subscription is created or
 * removed, so device lists and subscription-gated UI refresh without a
 * page reload.
 */
export const PUSH_SUBSCRIPTION_CHANGED_EVENT = "ya:push-subscription-changed";

export function notifyPushSubscriptionChanged(): void {
  window.dispatchEvent(new Event(PUSH_SUBSCRIPTION_CHANGED_EVENT));
}

export type PushDeliveryUrgency = "very-low" | "low" | "normal" | "high";
export type TestNotificationUrgency = "normal" | "persistent" | "silent";
export type PushDeviceType =
  | "android"
  | "ios"
  | "mobile"
  | "desktop"
  | "unknown";

export interface SubscribedDevice {
  browserProfileId: string;
  createdAt: string;
  deviceName?: string;
  endpointDomain: string;
  deviceType: PushDeviceType;
}

interface SubscribedDevicesState {
  devices: SubscribedDevice[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook for managing all subscribed push notification devices.
 * Allows viewing and removing devices from any client.
 */
export function useSubscribedDevices() {
  const [state, setState] = useState<SubscribedDevicesState>({
    devices: [],
    isLoading: true,
    error: null,
  });

  const fetchDevices = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      const { subscriptions } = await api.getPushSubscriptions();
      setState({
        devices: subscriptions,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      console.error("[useSubscribedDevices] Failed to fetch:", err);
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load devices",
      }));
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // Refresh when this browser subscribes/unsubscribes, so gated UI
  // (e.g. server notification toggles) unlocks without a reload.
  useEffect(() => {
    const handleChange = () => {
      fetchDevices();
    };
    window.addEventListener(PUSH_SUBSCRIPTION_CHANGED_EVENT, handleChange);
    return () =>
      window.removeEventListener(PUSH_SUBSCRIPTION_CHANGED_EVENT, handleChange);
  }, [fetchDevices]);

  // Quietly refresh the device list when the connection re-establishes.
  useBackgroundRevalidation({
    fetcher: () => api.getPushSubscriptions().then((r) => r.subscriptions),
    current: state.devices,
    apply: (devices) => setState((s) => ({ ...s, devices, error: null })),
  });

  const removeDevice = useCallback(
    async (browserProfileId: string) => {
      setState((s) => ({ ...s, isLoading: true, error: null }));

      try {
        await api.deletePushSubscription(browserProfileId);
        // Refresh the list
        await fetchDevices();
      } catch (err) {
        console.error("[useSubscribedDevices] Failed to remove:", err);
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : "Failed to remove device",
        }));
      }
    },
    [fetchDevices],
  );

  const sendTest = useCallback(
    async (
      browserProfileId: string,
      options: {
        displayUrgency?: TestNotificationUrgency;
        deliveryUrgency?: PushDeliveryUrgency;
        message?: string;
      } = {},
    ) => {
      await api.testPush(
        browserProfileId,
        options.message,
        options.displayUrgency,
        options.deliveryUrgency,
      );
    },
    [],
  );

  return {
    ...state,
    removeDevice,
    sendTest,
    refetch: fetchDevices,
  };
}
