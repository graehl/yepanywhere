import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import type { WSContext, WSEvents } from "hono/ws";
import { getLogger } from "../logging/logger.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import { DEFAULT_SERVER_SETTINGS } from "../services/ServerSettingsService.js";
import {
  persistSpeechAudio,
  type SpeechAudioRequestSource,
  type SpeechAudioRetentionResult,
  type SpeechTranscriptionContext,
} from "../services/voice/audioRetention.js";
import type { SpeechBackendRegistry } from "../services/voice/registry.js";
import type { TranscribeOptions } from "../services/voice/SpeechBackend.js";

const logger = getLogger();
const DEFAULT_MIME_TYPE = "audio/webm;codecs=opus";

// biome-ignore lint/suspicious/noExplicitAny: third-party WS upgrade type
type UpgradeWebSocketFn = (createEvents: (c: Context) => WSEvents) => any;

export interface SpeechRouteDeps {
  speechBackendRegistry: SpeechBackendRegistry;
  upgradeWebSocket: UpgradeWebSocketFn;
  dataDir?: string;
  serverSettingsService?: ServerSettingsService;
}

interface StartMsg {
  type: "start";
  backendId?: string;
  mimeType?: string;
  context?: unknown;
}
interface StopMsg {
  type: "stop";
}
type ClientMsg = StartMsg | StopMsg;

interface ServerMsg {
  type: "ready" | "interim" | "final" | "error";
  text?: string;
  message?: string;
  transcriptionId?: string;
}

type SpeechWsData = string | ArrayBuffer | SharedArrayBuffer | Buffer | Blob;

interface TranscribeBody {
  backendId?: unknown;
  mimeType?: unknown;
  audioBase64?: unknown;
  prompt?: unknown;
  keyterms?: unknown;
  context?: unknown;
}

function send(ws: WSContext, msg: ServerMsg): void {
  ws.send(JSON.stringify(msg));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseClientMsg(value: unknown): ClientMsg | null {
  if (!isRecord(value)) return null;
  if (value.type === "start") {
    return {
      type: "start",
      backendId:
        typeof value.backendId === "string" ? value.backendId : undefined,
      mimeType: typeof value.mimeType === "string" ? value.mimeType : undefined,
      context: value.context,
    };
  }
  if (value.type === "stop") {
    return { type: "stop" };
  }
  return null;
}

async function normalizeWsData(
  data: unknown,
): Promise<{ text: string | null; buffer: Buffer | null }> {
  if (typeof data === "string") {
    return { text: data, buffer: null };
  }
  const isSharedArrayBuffer =
    typeof SharedArrayBuffer !== "undefined" &&
    data instanceof SharedArrayBuffer;
  if (
    data instanceof ArrayBuffer ||
    isSharedArrayBuffer ||
    Buffer.isBuffer(data)
  ) {
    const buffer = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data as ArrayBuffer);
    return { text: buffer.toString("utf8"), buffer };
  }
  if (data instanceof Blob) {
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return { text: buffer.toString("utf8"), buffer };
  }
  return { text: null, buffer: null };
}

function parseWsControlMessage(text: string | null): ClientMsg | null {
  const trimmed = text?.trim();
  if (!trimmed?.startsWith("{")) return null;
  try {
    return parseClientMsg(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

async function transcribe(
  registry: SpeechBackendRegistry,
  backendId: string,
  audio: Buffer,
  options: TranscribeOptions,
): Promise<string> {
  const backend = registry.getBackend(backendId);
  if (!backend) {
    throw new Error(`Backend not available: ${backendId}`);
  }
  if (audio.length === 0) {
    return "";
  }
  return backend.transcribe(audio, options);
}

function cleanContextString(value: unknown, maxLength = 300): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function parseTranscriptionContext(
  value: unknown,
): SpeechTranscriptionContext | undefined {
  if (!isRecord(value)) return undefined;
  const context = {
    projectId: cleanContextString(value.projectId),
    sessionId: cleanContextString(value.sessionId),
    clientTurnId: cleanContextString(value.clientTurnId, 120),
    draftKey: cleanContextString(value.draftKey, 300),
  };
  const clean = Object.fromEntries(
    Object.entries(context).filter(([, entry]) => entry !== undefined),
  ) as SpeechTranscriptionContext;
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function getRetentionSettings(deps: SpeechRouteDeps) {
  return (
    deps.serverSettingsService?.getSetting("speechAudioRetention") ??
    DEFAULT_SERVER_SETTINGS.speechAudioRetention
  );
}

async function transcribeWithAudit(
  deps: SpeechRouteDeps,
  input: {
    source: SpeechAudioRequestSource;
    backendId: string;
    audio: Buffer;
    options: TranscribeOptions;
    context?: SpeechTranscriptionContext;
  },
): Promise<{ text: string; retention: SpeechAudioRetentionResult }> {
  const requestId = randomUUID();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const logContext = {
    component: "speech",
    requestId,
    source: input.source,
    backendId: input.backendId,
    mimeType: input.options.mimeType ?? DEFAULT_MIME_TYPE,
    audioBytes: input.audio.length,
    hasPrompt: !!input.options.prompt,
    keytermCount: input.options.keyterms?.length ?? 0,
    context: input.context,
  };

  logger.info(logContext, "Speech transcription started");

  try {
    const text = await transcribe(
      deps.speechBackendRegistry,
      input.backendId,
      input.audio,
      input.options,
    );
    const completedAtMs = Date.now();
    const completedAt = new Date(completedAtMs).toISOString();
    const retention = await persistSpeechAudio({
      dataDir: deps.dataDir,
      settings: getRetentionSettings(deps),
      requestId,
      source: input.source,
      backendId: input.backendId,
      mimeType: input.options.mimeType ?? DEFAULT_MIME_TYPE,
      audio: input.audio,
      transcript: text,
      startedAt,
      completedAt,
      durationMs: completedAtMs - startedAtMs,
      context: input.context,
    });

    logger.info(
      {
        ...logContext,
        durationMs: completedAtMs - startedAtMs,
        transcriptChars: text.length,
        transcriptionId: retention.transcriptionId,
        retention: {
          stored: retention.stored,
          reason: retention.reason,
          audioPath: retention.audioPath,
          metadataPath: retention.metadataPath,
          prunedFiles: retention.prunedFiles,
          prunedBytes: retention.prunedBytes,
          pruneError: retention.pruneError,
        },
      },
      "Speech transcription completed",
    );

    return { text, retention };
  } catch (err: unknown) {
    const durationMs = Date.now() - startedAtMs;
    logger.error(
      {
        ...logContext,
        durationMs,
        err,
      },
      "Speech transcription failed",
    );
    throw err;
  }
}

function parseTranscribeBody(value: unknown):
  | {
      ok: true;
      backendId: string;
      audio: Buffer;
      options: TranscribeOptions;
      context?: SpeechTranscriptionContext;
    }
  | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "Expected JSON object" };
  }
  const body = value as TranscribeBody;
  if (typeof body.backendId !== "string" || body.backendId.length === 0) {
    return { ok: false, message: "backendId is required" };
  }
  if (typeof body.audioBase64 !== "string") {
    return { ok: false, message: "audioBase64 is required" };
  }
  const audio = Buffer.from(body.audioBase64, "base64");
  const keyterms = Array.isArray(body.keyterms)
    ? body.keyterms.filter((term): term is string => typeof term === "string")
    : undefined;
  return {
    ok: true,
    backendId: body.backendId,
    audio,
    context: parseTranscriptionContext(body.context),
    options: {
      mimeType:
        typeof body.mimeType === "string" ? body.mimeType : DEFAULT_MIME_TYPE,
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      keyterms,
    },
  };
}

export function createSpeechRoutes(deps: SpeechRouteDeps): Hono {
  const routes = new Hono();

  routes.post("/transcribe", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = parseTranscribeBody(rawBody);
    if (!parsed.ok) {
      return c.json({ error: parsed.message }, 400);
    }

    try {
      const { text, retention } = await transcribeWithAudit(deps, {
        source: "http",
        backendId: parsed.backendId,
        audio: parsed.audio,
        options: parsed.options,
        context: parsed.context,
      });
      return c.json({ text, transcriptionId: retention.transcriptionId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  routes.get(
    "/ws",
    deps.upgradeWebSocket((_c: Context) => {
      const chunks: Buffer[] = [];
      let mimeType = DEFAULT_MIME_TYPE;
      let backendId: string | null = null;
      let context: SpeechTranscriptionContext | undefined;

      const processMessage = async (
        data: SpeechWsData,
        ws: WSContext,
      ): Promise<void> => {
        const normalized = await normalizeWsData(data);
        const msg = parseWsControlMessage(normalized.text);

        if (!msg) {
          if (normalized.buffer) {
            chunks.push(normalized.buffer);
          } else {
            logger.warn("Unparseable speech WS frame");
          }
          return;
        }

        if (msg.type === "start") {
          chunks.length = 0;
          backendId = msg.backendId ?? null;
          mimeType = msg.mimeType ?? DEFAULT_MIME_TYPE;
          context = parseTranscriptionContext(msg.context);
          return;
        }

        const audio = Buffer.concat(chunks);
        chunks.length = 0;

        if (!backendId) {
          send(ws, { type: "error", message: "No backend selected" });
          return;
        }

        try {
          const { text, retention } = await transcribeWithAudit(deps, {
            source: "ws",
            backendId,
            audio,
            options: { mimeType },
            context,
          });
          send(ws, {
            type: "final",
            text,
            transcriptionId: retention.transcriptionId,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          send(ws, { type: "error", message });
        }
      };

      return {
        onOpen(_evt: Event, ws: WSContext) {
          send(ws, { type: "ready" });
        },

        onMessage(evt: MessageEvent, ws: WSContext) {
          void processMessage(evt.data as SpeechWsData, ws);
        },

        onClose() {
          chunks.length = 0;
        },
      } satisfies WSEvents;
    }),
  );

  return routes;
}
