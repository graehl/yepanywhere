import type {
  HostAwakeFeatureSupport,
  HostAwakeMode,
  HostAwakePowerSource,
  HostAwakeState,
} from "@yep-anywhere/shared";

export interface HostAwakeRequest {
  mode: Exclude<HostAwakeMode, "off">;
  batteryFloorPercent: number;
}

export interface HostPowerSnapshot {
  hasInternalBattery: boolean | "unknown";
  powerSource: HostAwakePowerSource;
  batteryPercent?: number;
  powerObservedAt: number;
}

export interface HostAwakeBackendStatus extends HostPowerSnapshot {
  state: Extract<HostAwakeState, "active" | "paused-low-battery" | "error">;
  reason?: string;
}

export interface HostAwakeLease {
  status(): HostAwakeBackendStatus;
  release(): Promise<void>;
}

export interface HostAwakeBackend {
  readonly platform: NodeJS.Platform;
  readonly support: HostAwakeFeatureSupport;
  probe(): Promise<HostPowerSnapshot>;
  acquire(
    request: HostAwakeRequest,
    onStatus: (status: HostAwakeBackendStatus) => void,
  ): Promise<HostAwakeLease>;
}

export class HostAwakeUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostAwakeUnsupportedError";
  }
}

export const UNSUPPORTED_HOST_AWAKE_SUPPORT: HostAwakeFeatureSupport = {
  idleSleepPrevention: false,
  batteryFloor: false,
  closedLidOnExternalPower: false,
};
