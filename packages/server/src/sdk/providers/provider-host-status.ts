let providerHostDegraded = false;

export function setProviderHostDegraded(degraded: boolean): void {
  providerHostDegraded =
    (process.platform === "linux" || process.platform === "darwin") && degraded;
}

export function resetProviderHostDegradedForTests(): void {
  providerHostDegraded = false;
}

/** Boot tried to attach or start the provider host and still has none. */
export function isProviderHostDegraded(): boolean {
  return providerHostDegraded;
}
