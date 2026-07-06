import { generateUUID } from "./uuid";

export function createClientSpeechTurnId(): string {
  return generateUUID();
}

export function createSpeechTargetId(): string {
  return `speech-target-${generateUUID()}`;
}
