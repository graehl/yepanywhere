import type {
  AgentActivity,
  SessionOwnership,
  UrlProjectId,
} from "@yep-anywhere/shared";
import type { GlobalSessionItem, InboxResponse } from "../api/client";
import type { ProcessInfo } from "../hooks/useProcesses";
import { reportSessionLifecycleSnapshots } from "./sessionLifecycleExternalStore";
import type { SessionLifecycleSnapshotInput } from "./sessionLifecycleStore";

const INBOX_TIERS = [
  "needsAttention",
  "active",
  "recentActivity",
  "unread8h",
  "unread24h",
] as const;

type InboxTier = (typeof INBOX_TIERS)[number];

function toProjectId(projectId: string | UrlProjectId): UrlProjectId {
  return projectId as UrlProjectId;
}

export function createGlobalSessionLifecycleSnapshots(
  sessions: readonly GlobalSessionItem[],
): SessionLifecycleSnapshotInput[] {
  return sessions.map((session) => ({
    sessionId: session.id,
    projectId: toProjectId(session.projectId),
    ownership: session.ownership,
    activity: session.activity,
    pendingInputType: session.pendingInputType,
    hasUnread: session.hasUnread,
    title: session.title,
    customTitle: session.customTitle ?? null,
    updatedAt: session.updatedAt,
    includesActivity: true,
  }));
}

function inboxTierActivity(
  tier: InboxTier,
  activity: AgentActivity | undefined,
): AgentActivity | undefined {
  if (tier === "needsAttention") {
    return activity ?? "waiting-input";
  }
  if (tier === "active") {
    return activity ?? "in-turn";
  }
  return activity;
}

function inboxTierIncludesActivity(tier: InboxTier): boolean | undefined {
  return tier === "needsAttention" || tier === "active" ? true : undefined;
}

export function createInboxLifecycleSnapshots(
  inbox: InboxResponse,
): SessionLifecycleSnapshotInput[] {
  const snapshots: SessionLifecycleSnapshotInput[] = [];
  const seen = new Set<string>();

  for (const tier of INBOX_TIERS) {
    for (const item of inbox[tier]) {
      if (seen.has(item.sessionId)) {
        continue;
      }
      seen.add(item.sessionId);

      const activity = inboxTierActivity(tier, item.activity);
      snapshots.push({
        sessionId: item.sessionId,
        projectId: toProjectId(item.projectId),
        activity,
        pendingInputType:
          activity === "waiting-input" ? item.pendingInputType : undefined,
        hasUnread: item.hasUnread,
        title: item.sessionTitle,
        updatedAt: item.updatedAt,
        includesActivity: inboxTierIncludesActivity(tier),
      });
    }
  }

  return snapshots;
}

export function createProcessLifecycleSnapshots(
  processes: readonly ProcessInfo[],
): SessionLifecycleSnapshotInput[] {
  return processes.map((process) => ({
    sessionId: process.sessionId,
    projectId: process.projectId,
    ownership: {
      owner: "self",
      processId: process.id,
    } satisfies SessionOwnership,
    activity: process.state,
    title: process.sessionTitle,
    includesActivity: true,
  }));
}

export function reportGlobalSessionLifecycleSnapshots(
  sessions: readonly GlobalSessionItem[],
  requestStartedAt = Date.now(),
): void {
  reportSessionLifecycleSnapshots(
    createGlobalSessionLifecycleSnapshots(sessions),
    requestStartedAt,
  );
}

export function reportInboxLifecycleSnapshots(
  inbox: InboxResponse,
  requestStartedAt = Date.now(),
): void {
  reportSessionLifecycleSnapshots(
    createInboxLifecycleSnapshots(inbox),
    requestStartedAt,
  );
}

export function reportProcessLifecycleSnapshots(
  processes: readonly ProcessInfo[],
  requestStartedAt = Date.now(),
): void {
  reportSessionLifecycleSnapshots(
    createProcessLifecycleSnapshots(processes),
    requestStartedAt,
  );
}
