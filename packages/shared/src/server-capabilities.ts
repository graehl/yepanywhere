export type ServerCapabilityKind = "permanent" | "transitional";

export interface ServerCapabilitySource {
  capabilities?: readonly string[];
}

export interface ServerCapabilityPermanentLifecycle {
  kind: "permanent";
  reason: string;
}

export interface ServerCapabilityTransitionalLifecycle {
  kind: "transitional";
  reviewAfter: string;
  removeClientGateWhen: string;
  removeServerAdvertisementWhen?: string;
}

export interface ServerCapabilityDefinition {
  name: string;
  kind: ServerCapabilityKind;
  area: "projectQueue";
  description: string;
  introducedIn: string;
  clientFallback: string;
  serverContract?: {
    routes?: readonly string[];
    responseFields?: readonly string[];
    events?: readonly string[];
  };
  lifecycle:
    | ServerCapabilityPermanentLifecycle
    | ServerCapabilityTransitionalLifecycle;
}

export const SERVER_CAPABILITIES = {
  projectQueue: {
    name: "projectQueue",
    kind: "permanent",
    area: "projectQueue",
    introducedIn: "0.5.0",
    description:
      "Server supports durable project-scoped queue creation, listing, mutation, dispatch pause/resume, and promotion.",
    clientFallback: "Hide Project Queue entry points.",
    serverContract: {
      routes: [
        "GET /api/project-queue",
        "POST /api/project-queue/pause",
        "POST /api/project-queue/resume",
        "POST /api/projects/:projectId/queue",
      ],
      events: ["project-queue-changed"],
    },
    lifecycle: {
      kind: "permanent",
      reason:
        "Project Queue availability remains a server feature boundary for older servers and hosted remote clients.",
    },
  },
  projectQueueGlobalMoveToTop: {
    name: "projectQueueGlobalMoveToTop",
    kind: "transitional",
    area: "projectQueue",
    introducedIn: "0.6.0",
    description:
      "Server supports moving a Project Queue item to the visible global queue top while Project Queue dispatch is paused.",
    clientFallback:
      "Hide paused global Move to top; keep project-local reorder, edit, delete, retry, pause, and resume.",
    serverContract: {
      routes: ["POST /api/project-queue/:projectId/queue/:itemId/move-to-top"],
    },
    lifecycle: {
      kind: "transitional",
      reviewAfter: "2026-08-15",
      removeClientGateWhen:
        "Hosted client minimum supported server compatibility/version excludes servers without this route.",
      removeServerAdvertisementWhen:
        "No maintained client release still branches on this capability.",
    },
  },
} as const satisfies Record<string, ServerCapabilityDefinition>;

export type ServerCapabilityKey = keyof typeof SERVER_CAPABILITIES;
export type ServerCapabilityName =
  (typeof SERVER_CAPABILITIES)[ServerCapabilityKey]["name"];

export const PROJECT_QUEUE_CAPABILITY = SERVER_CAPABILITIES.projectQueue.name;

export const PROJECT_QUEUE_GLOBAL_MOVE_TO_TOP_CAPABILITY =
  SERVER_CAPABILITIES.projectQueueGlobalMoveToTop.name;

export function serverHasCapability(
  source: ServerCapabilitySource | null | undefined,
  capability: ServerCapabilityDefinition | ServerCapabilityName | string,
): boolean {
  const name = typeof capability === "string" ? capability : capability.name;
  return source?.capabilities?.includes(name) ?? false;
}
