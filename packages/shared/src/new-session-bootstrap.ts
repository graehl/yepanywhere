/** Explicit content negotiation on the existing settings resource. */
export const NEW_SESSION_BOOTSTRAP = "new-session-v1";

export const NEW_SESSION_BOOTSTRAP_PARTS = [
  "settings",
  "projects",
  "recents",
  "version",
  "provider",
] as const;

export type NewSessionBootstrapPart =
  (typeof NEW_SESSION_BOOTSTRAP_PARTS)[number];

/** Each finite SSE record preserves one canonical route's status and JSON. */
export interface NewSessionBootstrapFrame {
  part: NewSessionBootstrapPart;
  status: number;
  body: unknown;
}
