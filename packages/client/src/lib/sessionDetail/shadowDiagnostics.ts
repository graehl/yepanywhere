import { getMessageId } from "../mergeMessages";
import { UI_KEYS } from "../storageKeys";
import type { Message, SessionMetadata } from "../../types";
import type { PaginationInfo } from "../../api/client";
import type {
  AgentContentMap,
  SessionDetailState,
} from "./types";
import type { SessionRouteScrollSnapshot } from "../sessionRouteSnapshots";

type MessageSource = "sdk" | "jsonl" | undefined;

interface CompactMessage {
  id: string;
  type?: string;
  role?: string;
  source?: MessageSource;
  parent?: string | null;
  streaming?: true;
}

interface CompactAgent {
  status: string;
  count: number;
  first?: CompactMessage;
  last?: CompactMessage;
}

interface CompactPagination {
  hasOlderMessages?: boolean;
  truncatedBeforeMessageId?: string;
  totalMessageCount?: number;
  returnedMessageCount?: number;
  totalCompactions?: number;
}

interface CompactScrollSnapshot {
  atBottom: boolean;
  hasAnchor: boolean;
  anchorId?: string;
}

interface CompactSessionDetail {
  sessionId?: string;
  provider?: string;
  messageCount: number;
  messageHash: string;
  firstMessages: CompactMessage[];
  lastMessages: CompactMessage[];
  pagination?: CompactPagination;
  agentKeys: string[];
  agents: Record<string, CompactAgent>;
  toolUseToAgentEntries: Array<[string, string]>;
  lastMessageId?: string;
  maxPersistedTimestampMs: number;
  scrollSnapshot?: CompactScrollSnapshot;
}

export interface SessionDetailRuntimeStateInput {
  messages: readonly Message[];
  session: SessionMetadata | null;
  pagination?: PaginationInfo;
  agentContent: AgentContentMap;
  toolUseToAgentEntries: Array<[string, string]>;
  lastMessageId?: string;
  maxPersistedTimestampMs: number;
  scrollSnapshot?: SessionRouteScrollSnapshot;
}

export interface SessionDetailShadowDivergenceInput {
  boundary: string;
  projectId: string;
  sessionId: string;
  provider?: string;
  live: SessionDetailRuntimeStateInput;
  shadow: SessionDetailState;
}

declare global {
  interface Window {
    __YA_SESSION_DETAIL_SHADOW_DIAGNOSTICS__?: boolean;
  }
}

const MESSAGE_SAMPLE_SIZE = 6;
const loggedDivergenceKeys = new Set<string>();

function readLocalStorageFlag(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }
  try {
    return localStorage.getItem(UI_KEYS.sessionDetailShadowDiagnostics) === "true";
  } catch {
    return false;
  }
}

export function isSessionDetailShadowDiagnosticsEnabled(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  if (
    typeof window !== "undefined" &&
    window.__YA_SESSION_DETAIL_SHADOW_DIAGNOSTICS__ === true
  ) {
    return true;
  }
  return readLocalStorageFlag();
}

function compactMessage(message: Message | undefined): CompactMessage | undefined {
  if (!message) {
    return undefined;
  }
  const role = message.message?.role ?? message.role;
  return {
    id: getMessageId(message),
    type: message.type,
    role,
    source: message._source,
    parent: message.parentUuid,
    ...(message._isStreaming === true ? { streaming: true } : {}),
  };
}

function compactMessages(messages: readonly Message[]): CompactMessage[] {
  return messages
    .map((message) => compactMessage(message))
    .filter((message): message is CompactMessage => message !== undefined);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function compactPagination(
  pagination: PaginationInfo | undefined,
): CompactPagination | undefined {
  if (!pagination) {
    return undefined;
  }
  return {
    hasOlderMessages: pagination.hasOlderMessages,
    truncatedBeforeMessageId: pagination.truncatedBeforeMessageId,
    totalMessageCount: pagination.totalMessageCount,
    returnedMessageCount: pagination.returnedMessageCount,
    totalCompactions: pagination.totalCompactions,
  };
}

function compactScrollSnapshot(
  scrollSnapshot: SessionRouteScrollSnapshot | undefined,
): CompactScrollSnapshot | undefined {
  if (!scrollSnapshot) {
    return undefined;
  }
  return {
    atBottom: scrollSnapshot.atBottom,
    hasAnchor: scrollSnapshot.anchor !== undefined,
    anchorId: scrollSnapshot.anchor?.id,
  };
}

function compactAgent(agentContent: AgentContentMap[string]): CompactAgent {
  return {
    status: agentContent.status,
    count: agentContent.messages.length,
    first: compactMessage(agentContent.messages[0]),
    last: compactMessage(agentContent.messages.at(-1)),
  };
}

function compactSessionDetail(
  input: SessionDetailRuntimeStateInput,
): CompactSessionDetail {
  const messages = compactMessages(input.messages);
  const agentKeys = Object.keys(input.agentContent).sort();
  const agents = Object.fromEntries(
    agentKeys.flatMap((agentId) => {
      const agentContent = input.agentContent[agentId];
      return agentContent ? [[agentId, compactAgent(agentContent)]] : [];
    }),
  );
  const toolUseToAgentEntries = [...input.toolUseToAgentEntries].sort(
    ([left], [right]) => left.localeCompare(right),
  );

  return {
    sessionId: input.session?.id,
    provider: input.session?.provider,
    messageCount: messages.length,
    messageHash: hashString(JSON.stringify(messages)),
    firstMessages: messages.slice(0, MESSAGE_SAMPLE_SIZE),
    lastMessages: messages.slice(-MESSAGE_SAMPLE_SIZE),
    pagination: compactPagination(input.pagination),
    agentKeys,
    agents,
    toolUseToAgentEntries,
    lastMessageId: input.lastMessageId,
    maxPersistedTimestampMs: input.maxPersistedTimestampMs,
    scrollSnapshot: compactScrollSnapshot(input.scrollSnapshot),
  };
}

function comparableCompact(input: CompactSessionDetail): string {
  return JSON.stringify({
    sessionId: input.sessionId,
    provider: input.provider,
    messageCount: input.messageCount,
    messageHash: input.messageHash,
    pagination: input.pagination,
    agentKeys: input.agentKeys,
    agents: input.agents,
    toolUseToAgentEntries: input.toolUseToAgentEntries,
    lastMessageId: input.lastMessageId,
    maxPersistedTimestampMs: input.maxPersistedTimestampMs,
    scrollSnapshot: input.scrollSnapshot,
  });
}

function findFirstMessageDiff(
  liveMessages: readonly Message[],
  shadowMessages: readonly Message[],
): { index: number; live?: CompactMessage; shadow?: CompactMessage } | null {
  const count = Math.max(liveMessages.length, shadowMessages.length);
  for (let index = 0; index < count; index += 1) {
    const live = compactMessage(liveMessages[index]);
    const shadow = compactMessage(shadowMessages[index]);
    if (JSON.stringify(live) !== JSON.stringify(shadow)) {
      return { index, live, shadow };
    }
  }
  return null;
}

function buildShadowRuntimeInput(
  shadow: SessionDetailState,
): SessionDetailRuntimeStateInput {
  return {
    messages: shadow.messages,
    session: shadow.session,
    pagination: shadow.pagination,
    agentContent: shadow.agentContent,
    toolUseToAgentEntries: shadow.toolUseToAgentEntries,
    lastMessageId: shadow.lastMessageId,
    maxPersistedTimestampMs: shadow.maxPersistedTimestampMs,
    scrollSnapshot: shadow.scrollSnapshot,
  };
}

export function reportSessionDetailShadowDivergence(
  input: SessionDetailShadowDivergenceInput,
): void {
  if (!isSessionDetailShadowDiagnosticsEnabled()) {
    return;
  }

  const live = compactSessionDetail(input.live);
  const shadow = compactSessionDetail(buildShadowRuntimeInput(input.shadow));
  const liveKey = comparableCompact(live);
  const shadowKey = comparableCompact(shadow);
  if (liveKey === shadowKey) {
    return;
  }

  const divergenceKey = [
    input.boundary,
    input.projectId,
    input.sessionId,
    hashString(liveKey),
    hashString(shadowKey),
  ].join(":");
  if (loggedDivergenceKeys.has(divergenceKey)) {
    return;
  }
  loggedDivergenceKeys.add(divergenceKey);

  console.warn("[SessionDetailShadow]", {
    event: "session-detail-shadow-divergence",
    boundary: input.boundary,
    projectId: input.projectId,
    sessionId: input.sessionId,
    provider: input.provider ?? live.provider ?? shadow.provider,
    firstMessageDiff: findFirstMessageDiff(
      input.live.messages,
      input.shadow.messages,
    ),
    live,
    shadow,
  });
}

export function __resetSessionDetailShadowDiagnosticsForTest(): void {
  loggedDivergenceKeys.clear();
}
