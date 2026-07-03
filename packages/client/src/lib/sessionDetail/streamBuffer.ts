import type { Message } from "../../types";

export type SessionDetailBufferedStreamEvent =
  | {
      type: "message";
      message: Message;
    }
  | {
      type: "subagent";
      message: Message;
      agentId: string;
    };

export type SessionDetailStreamBuffer = SessionDetailBufferedStreamEvent[];

export function createSessionDetailStreamBuffer(): SessionDetailStreamBuffer {
  return [];
}

export function bufferSessionDetailStreamMessage(
  buffer: SessionDetailStreamBuffer,
  message: Message,
): void {
  buffer.push({ type: "message", message });
}

export function bufferSessionDetailStreamSubagentMessage(
  buffer: SessionDetailStreamBuffer,
  message: Message,
  agentId: string,
): void {
  buffer.push({ type: "subagent", message, agentId });
}

export function drainSessionDetailStreamBuffer(
  buffer: SessionDetailStreamBuffer,
): SessionDetailBufferedStreamEvent[] {
  const drained = buffer.slice();
  resetSessionDetailStreamBuffer(buffer);
  return drained;
}

export function resetSessionDetailStreamBuffer(
  buffer: SessionDetailStreamBuffer,
): void {
  buffer.length = 0;
}
