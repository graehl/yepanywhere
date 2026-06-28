/**
 * Push notification types
 */

/** Web Push subscription from the browser's PushManager */
export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/** Stored subscription with metadata */
export interface StoredSubscription {
  /** The push subscription from the browser */
  subscription: PushSubscription;
  /** When this subscription was created */
  createdAt: string;
  /** User agent of the subscribing browser */
  userAgent?: string;
  /** Optional friendly name for the device */
  deviceName?: string;
}

/** Server-side notification settings (controls what types of notifications are sent) */
export interface NotificationSettings {
  /** Send notifications for tool approval requests */
  toolApproval: boolean;
  /** Send notifications for user questions */
  userQuestion: boolean;
  /** Send notifications when sessions halt/complete */
  sessionHalted: boolean;
  /** Send notifications when a project becomes fully inactive */
  projectInactive: boolean;
  /** Send notifications when all YA-managed work becomes inactive */
  yaInactive: boolean;
}

/** Default notification settings for new or missing preference files. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  toolApproval: true,
  userQuestion: true,
  sessionHalted: false,
  projectInactive: false,
  yaInactive: false,
};

/** Subscription storage state */
export interface SubscriptionState {
  /** Schema version for future migrations */
  version: number;
  /** Map of browserProfileId -> subscription info */
  subscriptions: Record<string, StoredSubscription>;
  /** Server-side notification type settings */
  settings?: Partial<NotificationSettings>;
}

/** Push notification payload types */
export type PushPayloadType =
  | "pending-input"
  | "session-halted"
  | "project-inactive"
  | "ya-inactive"
  | "dismiss"
  | "test";

/** Base push payload */
interface BasePushPayload {
  type: PushPayloadType;
  timestamp: string;
}

/** Notification for pending input (approval/question) */
export interface PendingInputPayload extends BasePushPayload {
  type: "pending-input";
  sessionId: string;
  projectId: string;
  projectName: string;
  inputType: "tool-approval" | "user-question";
  /** Brief summary of what needs approval */
  summary: string;
  /** ID of the input request (legacy, no longer used by client) */
  requestId?: string;
}

/** Notification for session that stopped working */
export interface SessionHaltedPayload extends BasePushPayload {
  type: "session-halted";
  sessionId: string;
  projectId: string;
  projectName: string;
  reason: "completed" | "error" | "idle";
  /** How long the session was running (ms) */
  duration: number;
}

/** Notification for a project becoming inactive after active work drains. */
export interface ProjectInactivePayload extends BasePushPayload {
  type: "project-inactive";
  projectId: string;
  projectName: string;
  failedProjectQueueCount?: number;
}

/** Notification for the whole YA instance becoming inactive. */
export interface YaInactivePayload extends BasePushPayload {
  type: "ya-inactive";
  projectCount?: number;
}

/** Dismiss notification on other devices */
export interface DismissPayload extends BasePushPayload {
  type: "dismiss";
  sessionId: string;
}

/** Test notification urgency levels */
export type TestNotificationUrgency = "normal" | "persistent" | "silent";

/** Web Push protocol delivery urgency values. */
export type PushDeliveryUrgency = "very-low" | "low" | "normal" | "high";

/** Test notification */
export interface TestPayload extends BasePushPayload {
  type: "test";
  message: string;
  /** Controls notification behavior: normal (auto-dismiss), persistent (stays visible), silent (no sound) */
  urgency?: TestNotificationUrgency;
}

export type PushPayload =
  | PendingInputPayload
  | SessionHaltedPayload
  | ProjectInactivePayload
  | YaInactivePayload
  | DismissPayload
  | TestPayload;

/** Result of sending a push notification */
export interface SendResult {
  browserProfileId: string;
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** HTTP status code from push service */
  statusCode?: number;
}
