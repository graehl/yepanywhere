import {
  HELPER_SIDE_MODEL_CHEAPEST,
  HELPER_SIDE_MODEL_SAME_AS_MAIN,
  PROMPT_SUGGESTION_MODES,
  type PromptSuggestionMode,
  RECAP_MODES,
  type RecapMode,
  type UserMessageDeliveryIntent,
  type UserMessageMetadata,
  clampPatientPatienceSeconds,
  clampRecapAfterSeconds,
} from "@yep-anywhere/shared";
import type { ResumeMode } from "../supervisor/Supervisor.js";
import {
  isValidSshHostAlias,
  normalizeSshHostAlias,
} from "../utils/sshHostAlias.js";

export function parseOptionalExecutor(rawExecutor: unknown): {
  executor: string | undefined;
  error?: string;
} {
  if (rawExecutor === undefined || rawExecutor === null) {
    return { executor: undefined };
  }
  if (typeof rawExecutor !== "string") {
    return { executor: undefined, error: "executor must be a string" };
  }

  const executor = normalizeSshHostAlias(rawExecutor);
  if (!executor) {
    return { executor: undefined };
  }
  if (!isValidSshHostAlias(executor)) {
    return {
      executor: undefined,
      error: "executor must be a valid SSH host alias",
    };
  }

  return { executor };
}

export function normalizeOptionalServiceTier(
  rawServiceTier: unknown,
): string | undefined {
  if (typeof rawServiceTier !== "string") {
    return undefined;
  }
  const serviceTier = rawServiceTier.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(serviceTier) ? serviceTier : undefined;
}

export function parseOptionalResumeMode(rawMode: unknown): {
  resumeMode: ResumeMode | undefined;
  error?: string;
} {
  if (rawMode === undefined || rawMode === null || rawMode === "") {
    return { resumeMode: undefined };
  }
  if (rawMode === "full" || rawMode === "compact-first") {
    return { resumeMode: rawMode };
  }
  return {
    resumeMode: undefined,
    error: "resumeMode must be one of: full, compact-first",
  };
}

function parseOptionalRecapMode(rawMode: unknown): {
  recapMode: RecapMode | undefined;
  error?: string;
} {
  if (rawMode === undefined || rawMode === null || rawMode === "") {
    return { recapMode: undefined };
  }
  if (
    typeof rawMode !== "string" ||
    !RECAP_MODES.includes(rawMode as RecapMode)
  ) {
    return {
      recapMode: undefined,
      error: `recapMode must be one of: ${RECAP_MODES.join(", ")}`,
    };
  }
  return { recapMode: rawMode as RecapMode };
}

function parseOptionalRecapAfterSeconds(rawValue: unknown): {
  recapAfterSeconds: number | undefined;
  error?: string;
} {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { recapAfterSeconds: undefined };
  }
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return {
      recapAfterSeconds: undefined,
      error: "recapAfterSeconds must be a finite number",
    };
  }
  return { recapAfterSeconds: clampRecapAfterSeconds(rawValue) };
}

function parseOptionalPromptSuggestionMode(rawMode: unknown): {
  promptSuggestionMode: PromptSuggestionMode | undefined;
  error?: string;
} {
  if (rawMode === undefined || rawMode === null || rawMode === "") {
    return { promptSuggestionMode: undefined };
  }
  if (
    typeof rawMode !== "string" ||
    !PROMPT_SUGGESTION_MODES.includes(rawMode as PromptSuggestionMode)
  ) {
    return {
      promptSuggestionMode: undefined,
      error: "promptSuggestionMode must be one of: off, native",
    };
  }
  return { promptSuggestionMode: rawMode as PromptSuggestionMode };
}

function parseOptionalHelperSideModel(rawModel: unknown): {
  helperSideModel: string | undefined;
  error?: string;
} {
  if (rawModel === undefined || rawModel === null || rawModel === "") {
    return { helperSideModel: undefined };
  }
  if (typeof rawModel !== "string") {
    return {
      helperSideModel: undefined,
      error: "helperSideModel must be a string",
    };
  }
  const trimmed = rawModel.trim();
  if (!trimmed) {
    return { helperSideModel: undefined };
  }
  return {
    helperSideModel:
      trimmed === HELPER_SIDE_MODEL_SAME_AS_MAIN
        ? HELPER_SIDE_MODEL_SAME_AS_MAIN
        : trimmed === HELPER_SIDE_MODEL_CHEAPEST
          ? HELPER_SIDE_MODEL_CHEAPEST
          : trimmed.slice(0, 200),
  };
}

export function parseHelperSettings(body: {
  recapMode?: unknown;
  recapAfterSeconds?: unknown;
  promptSuggestionMode?: unknown;
  helperSideModel?: unknown;
}): {
  recapMode: RecapMode | undefined;
  recapAfterSeconds: number | undefined;
  promptSuggestionMode: PromptSuggestionMode | undefined;
  helperSideModel: string | undefined;
  error?: string;
} {
  const recap = parseOptionalRecapMode(body.recapMode);
  if (recap.error) {
    return {
      recapMode: undefined,
      recapAfterSeconds: undefined,
      promptSuggestionMode: undefined,
      helperSideModel: undefined,
      error: recap.error,
    };
  }
  const recapAfter = parseOptionalRecapAfterSeconds(body.recapAfterSeconds);
  if (recapAfter.error) {
    return {
      recapMode: undefined,
      recapAfterSeconds: undefined,
      promptSuggestionMode: undefined,
      helperSideModel: undefined,
      error: recapAfter.error,
    };
  }
  const promptSuggestion = parseOptionalPromptSuggestionMode(
    body.promptSuggestionMode,
  );
  if (promptSuggestion.error) {
    return {
      recapMode: undefined,
      recapAfterSeconds: undefined,
      promptSuggestionMode: undefined,
      helperSideModel: undefined,
      error: promptSuggestion.error,
    };
  }
  const helperModel = parseOptionalHelperSideModel(body.helperSideModel);
  if (helperModel.error) {
    return {
      recapMode: undefined,
      recapAfterSeconds: undefined,
      promptSuggestionMode: undefined,
      helperSideModel: undefined,
      error: helperModel.error,
    };
  }
  return {
    recapMode: recap.recapMode,
    recapAfterSeconds: recapAfter.recapAfterSeconds,
    promptSuggestionMode: promptSuggestion.promptSuggestionMode,
    helperSideModel: helperModel.helperSideModel,
  };
}

const USER_MESSAGE_DELIVERY_INTENTS: ReadonlySet<UserMessageDeliveryIntent> =
  new Set(["direct", "steer", "deferred", "patient"]);

interface UserMessageMetadataBody {
  clientTimestamp?: unknown;
  messageMetadata?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

function parseDeliveryIntent(
  value: unknown,
): UserMessageDeliveryIntent | undefined {
  return typeof value === "string" &&
    USER_MESSAGE_DELIVERY_INTENTS.has(value as UserMessageDeliveryIntent)
    ? (value as UserMessageDeliveryIntent)
    : undefined;
}

function parseShortString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function parseStringList(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .map((entry) => parseShortString(entry, maxLength))
    .filter((entry): entry is string => entry !== undefined)
    .slice(0, maxItems);
  return parsed.length > 0 ? parsed : undefined;
}

export function buildUserMessageMetadata(
  body: UserMessageMetadataBody,
  serverTimestamp: number,
  fallbackIntent: UserMessageDeliveryIntent,
): UserMessageMetadata {
  const rawMetadata = isRecord(body.messageMetadata)
    ? body.messageMetadata
    : {};
  const rawComposition = isRecord(rawMetadata.composition)
    ? rawMetadata.composition
    : {};
  const composition = {
    typingStartedAt: parseIsoTimestamp(rawComposition.typingStartedAt),
    typingEndedAt: parseIsoTimestamp(rawComposition.typingEndedAt),
    lastEditedAt: parseIsoTimestamp(rawComposition.lastEditedAt),
    submittedAt: parseIsoTimestamp(rawComposition.submittedAt),
  };
  const cleanComposition = Object.fromEntries(
    Object.entries(composition).filter(([, value]) => value !== undefined),
  ) as NonNullable<UserMessageMetadata["composition"]>;
  const clientTimestamp =
    typeof body.clientTimestamp === "number" &&
    Number.isFinite(body.clientTimestamp)
      ? body.clientTimestamp
      : undefined;
  const rawSpeech = isRecord(rawMetadata.speech) ? rawMetadata.speech : {};
  const speechClientTurnId = parseShortString(rawSpeech.clientTurnId, 120);
  const speechTranscriptionIds = parseStringList(
    rawSpeech.transcriptionIds,
    20,
    120,
  );
  const speech =
    speechClientTurnId || speechTranscriptionIds
      ? {
          ...(speechClientTurnId ? { clientTurnId: speechClientTurnId } : {}),
          ...(speechTranscriptionIds
            ? { transcriptionIds: speechTranscriptionIds }
            : {}),
        }
      : undefined;

  const deliveryIntent =
    parseDeliveryIntent(rawMetadata.deliveryIntent) ?? fallbackIntent;
  const patienceSeconds =
    deliveryIntent === "patient"
      ? clampPatientPatienceSeconds(rawMetadata.patienceSeconds)
      : undefined;
  const steerNow =
    deliveryIntent === "steer" && rawMetadata.steerNow === true
      ? true
      : undefined;

  return {
    deliveryIntent,
    ...(patienceSeconds !== undefined ? { patienceSeconds } : {}),
    ...(steerNow ? { steerNow } : {}),
    ...(Object.keys(cleanComposition).length > 0
      ? { composition: cleanComposition }
      : {}),
    ...(speech ? { speech } : {}),
    ...(clientTimestamp !== undefined ? { clientTimestamp } : {}),
    serverReceivedAt: new Date(serverTimestamp).toISOString(),
  };
}
