/** Distinct from the legacy narrow ya-agent self/view connection. */
export const AGENT_API_BOOTSTRAP_ENV = {
  url: "AGENT_YA_V0_URL",
  socket: "AGENT_YA_V0_SOCKET",
  authorization: "AGENT_YA_V0_AUTHORIZATION",
} as const;

/** Values are variable references only; never render an actual credential. */
export function agentApiBootstrapInstructions(windows: boolean): string {
  const command = windows
    ? 'curl.exe -H "Authorization: $env:AGENT_YA_V0_AUTHORIZATION" "$env:AGENT_YA_V0_URL/v0/me"'
    : 'curl --unix-socket "$AGENT_YA_V0_SOCKET" -H "Authorization: $AGENT_YA_V0_AUTHORIZATION" "$AGENT_YA_V0_URL/v0/me"';
  return [
    "[Yep Anywhere API]",
    "You are running inside Yep Anywhere. Inspect your owning session, server and API access with:",
    command,
    "Use the same connection for GET /v0/help to learn available operations and examples, and GET /v0/schema for exact request/response details. This API currently reads authorized project/session catalogs; session creation, messaging, command execution and peer routing are not implemented in v0. Inherited child environments identify the owning YA session. If connection variables are missing, report API access unavailable; do not guess a port or reuse another credential.",
  ].join("\n");
}
