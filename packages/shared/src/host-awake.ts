export const HOST_AWAKE_MODES = [
  "off",
  "idle",
  "idle-and-closed-lid-on-external-power",
] as const;

export type HostAwakeMode = (typeof HOST_AWAKE_MODES)[number];

export const DEFAULT_HOST_AWAKE_BATTERY_FLOOR_PERCENT = 10;
export const MIN_HOST_AWAKE_BATTERY_FLOOR_PERCENT = 1;
export const MAX_HOST_AWAKE_BATTERY_FLOOR_PERCENT = 100;

export interface HostAwakeFeatureSupport {
  idleSleepPrevention: boolean;
  batteryFloor: boolean;
  closedLidOnExternalPower: boolean;
}

export type HostAwakeState =
  | "disabled"
  | "active"
  | "paused-low-battery"
  | "unsupported"
  | "error";

export type HostAwakePowerSource = "battery" | "external" | "unknown";

export interface HostAwakeStatus {
  requestedMode: HostAwakeMode;
  state: HostAwakeState;
  platform: string;
  support: HostAwakeFeatureSupport;
  hasInternalBattery: boolean | "unknown";
  powerSource?: HostAwakePowerSource;
  batteryPercent?: number;
  powerObservedAt?: number;
  batteryFloorPercent: number;
  reason?: string;
}

export function isHostAwakeMode(value: unknown): value is HostAwakeMode {
  return (
    typeof value === "string" &&
    (HOST_AWAKE_MODES as readonly string[]).includes(value)
  );
}

export function isHostAwakeBatteryFloorPercent(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_HOST_AWAKE_BATTERY_FLOOR_PERCENT &&
    value <= MAX_HOST_AWAKE_BATTERY_FLOOR_PERCENT
  );
}
