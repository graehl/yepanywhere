export const INBOX_TIERS = [
  "needsAttention",
  "active",
  "recentActivity",
  "unread8h",
  "unread24h",
] as const;

export type InboxTier = (typeof INBOX_TIERS)[number];

export function createEmptyInboxTierRecord<T>(
  createValue: () => T,
): Record<InboxTier, T> {
  return {
    needsAttention: createValue(),
    active: createValue(),
    recentActivity: createValue(),
    unread8h: createValue(),
    unread24h: createValue(),
  };
}
