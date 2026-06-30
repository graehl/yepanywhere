export type SafeRestartStatus = "idle" | "scheduled" | "restarting";

export type SafeRestartBlockerType = "active-sessions" | "session-queue";

export interface SafeRestartBlocker {
  type: SafeRestartBlockerType;
  count: number;
}

export type SafeRestartPreservedWorkType = "recovered-session-queue";

export interface SafeRestartPreservedWork {
  type: SafeRestartPreservedWorkType;
  count: number;
}

export interface SafeRestartState {
  status: SafeRestartStatus;
  blockers: SafeRestartBlocker[];
  preserved?: SafeRestartPreservedWork[];
  canRestartNow: boolean;
  scheduledAt?: string;
  updatedAt: string;
}

export interface SafeRestartChangedEvent {
  type: "safe-restart-changed";
  state: SafeRestartState;
  timestamp: string;
}
