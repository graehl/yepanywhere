const ACTIVE_SESSION_HOVERCARD_EVENT = "active-session-hovercard";

const sessionHoverCardEvents = new EventTarget();
let nextSessionHoverCardId = 0;

export function createSessionHoverCardId(): string {
  nextSessionHoverCardId += 1;
  return `session-hovercard-${nextSessionHoverCardId}`;
}

export function announceActiveSessionHoverCard(id: string): void {
  sessionHoverCardEvents.dispatchEvent(
    new CustomEvent<string>(ACTIVE_SESSION_HOVERCARD_EVENT, { detail: id }),
  );
}

export function subscribeActiveSessionHoverCard(
  listener: (id: string) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<string>).detail);
  };
  sessionHoverCardEvents.addEventListener(
    ACTIVE_SESSION_HOVERCARD_EVENT,
    handler,
  );
  return () => {
    sessionHoverCardEvents.removeEventListener(
      ACTIVE_SESSION_HOVERCARD_EVENT,
      handler,
    );
  };
}
