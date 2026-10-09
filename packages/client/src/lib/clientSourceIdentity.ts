export type ClientSummarySourceKey = string & {
  readonly __brand: "ClientSummarySourceKey";
};

export function asClientSummarySourceKey(
  value: string,
): ClientSummarySourceKey {
  return value as ClientSummarySourceKey;
}

export function createClientSummaryHostSourceKey(
  savedHostId: string,
): ClientSummarySourceKey {
  return asClientSummarySourceKey(`host:${savedHostId}`);
}

export function createClientSummaryDirectSourceKey(
  normalizedWsUrl: string,
): ClientSummarySourceKey {
  return asClientSummarySourceKey(`direct:${normalizedWsUrl}`);
}

export const LOCAL_CLIENT_SUMMARY_SOURCE_KEY =
  asClientSummarySourceKey("local");

export const REMOTE_NONE_CLIENT_SUMMARY_SOURCE_KEY =
  asClientSummarySourceKey("remote:none");
