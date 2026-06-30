export type SafeRestartStatus = "idle" | "scheduled" | "restarting";

export type SafeRestartBlockerType = "active-sessions" | "session-queue";

export interface SafeRestartBlocker {
  type: SafeRestartBlockerType;
  count: number;
}

export interface SafeRestartState {
  status: SafeRestartStatus;
  blockers: SafeRestartBlocker[];
  canRestartNow: boolean;
  scheduledAt?: string;
  updatedAt: string;
}

export interface SafeRestartChangedEvent {
  type: "safe-restart-changed";
  state: SafeRestartState;
  timestamp: string;
}
