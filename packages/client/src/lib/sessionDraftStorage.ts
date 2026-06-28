export const SESSION_DRAFT_KEY_PREFIX = "draft-message-";

export function isSessionDraftStorageKey(
  key: string | null | undefined,
): boolean {
  return key?.startsWith(SESSION_DRAFT_KEY_PREFIX) ?? false;
}

export function scanSessionDraftIds(): Set<string> {
  const result = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isSessionDraftStorageKey(key)) {
        continue;
      }
      const value = localStorage.getItem(key);
      if (value?.trim()) {
        result.add(key.slice(SESSION_DRAFT_KEY_PREFIX.length));
      }
    }
  } catch {
    // localStorage might be unavailable.
  }
  return result;
}
