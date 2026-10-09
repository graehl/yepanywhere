/** The browser storage address for a draft belonging to one account. */
export function accountDraftStorageKey(
  key: string,
  owner: string | null,
): string {
  return owner ? `draft-account:${encodeURIComponent(owner)}:${key}` : key;
}
