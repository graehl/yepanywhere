import type {
  PublicSessionShareMode,
  PublicSessionShareResponse,
  RelayResponse,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { BrandWordmark } from "../components/BrandWordmark";
import { MessageList } from "../components/MessageList";
import { SchemaValidationProvider } from "../contexts/SchemaValidationContext";
import { SessionMetadataProvider } from "../contexts/SessionMetadataContext";
import { StreamingMarkdownProvider } from "../contexts/StreamingMarkdownContext";
import { ToastProvider } from "../contexts/ToastContext";
import { useI18n } from "../i18n";
import type { Message } from "../types";

const DEFAULT_RELAY_URL = "wss://relay.yepanywhere.com/ws";
const LIVE_POLL_MS = 5000;
const RETRY_POLL_MS = 2000;

interface PublicShareHints {
  initialPrompt: string | null;
  mode: PublicSessionShareMode | null;
  projectName: string | null;
  title: string | null;
}

function generateRequestId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function decodeWebSocketData(data: MessageEvent["data"]): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Blob) {
    return await data.text();
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  return String(data);
}

async function fetchPublicShareViaRelay(options: {
  relayUrl: string;
  relayUsername: string;
  secret: string;
}): Promise<PublicSessionShareResponse> {
  const { relayUrl, relayUsername, secret } = options;
  const ws = new WebSocket(relayUrl);
  const requestId = generateRequestId();

  return await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      ws.close();
      reject(new Error("Share request timed out"));
    }, 30000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "client_connect", username: relayUsername }));
    };

    ws.onerror = () => {
      cleanup();
      reject(new Error("Relay connection failed"));
    };

    ws.onclose = () => {
      cleanup();
      reject(new Error("Relay connection closed"));
    };

    ws.onmessage = (event) => {
      void (async () => {
        let message: unknown;
        try {
          message = JSON.parse(await decodeWebSocketData(event.data));
        } catch {
          return;
        }

        if (
          message &&
          typeof message === "object" &&
          (message as { type?: unknown }).type === "client_connected"
        ) {
          ws.send(
            JSON.stringify({
              type: "request",
              id: requestId,
              method: "GET",
              path: `/public-api/shares/${encodeURIComponent(secret)}`,
              headers: {},
            }),
          );
          return;
        }

        if (
          message &&
          typeof message === "object" &&
          (message as RelayResponse).type === "response" &&
          (message as RelayResponse).id === requestId
        ) {
          const response = message as RelayResponse;
          cleanup();
          ws.close();
          if (response.status >= 400) {
            reject(new Error("Share not found"));
            return;
          }
          resolve(response.body as PublicSessionShareResponse);
        }
      })();
    };
  });
}

function parseShareHints(hash: string): PublicShareHints {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const mode = params.get("m");
  return {
    initialPrompt: params.get("q"),
    mode: mode === "frozen" || mode === "live" ? mode : null,
    projectName: params.get("p"),
    title: params.get("t"),
  };
}

function buildPreviewMessage(initialPrompt: string | null): Message[] {
  if (!initialPrompt) {
    return [];
  }
  return [
    {
      type: "user",
      uuid: "public-share-initial-prompt-preview",
      message: { role: "user", content: initialPrompt },
      timestamp: new Date(0).toISOString(),
      content: initialPrompt,
      role: "user",
    } as Message,
  ];
}

function shouldRetryPublicShareError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message === "Relay connection closed" ||
    error.message === "Relay connection failed" ||
    error.message === "Share request timed out"
  );
}

export function PublicSharePage() {
  const { t } = useI18n();
  const { secret } = useParams<{ secret: string }>();
  const [searchParams] = useSearchParams();
  const [share, setShare] = useState<PublicSessionShareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const relayUsername = searchParams.get("h") ?? "";
  const relayUrl = searchParams.get("r") ?? DEFAULT_RELAY_URL;
  const hints = useMemo(() => parseShareHints(window.location.hash), []);

  const title = useMemo(
    () =>
      share?.share.title ??
      share?.session.customTitle ??
      share?.session.title ??
      hints.title,
    [share, hints.title],
  );
  const projectName = share?.share.source.projectName ?? hints.projectName;
  const mode = share?.share.mode ?? hints.mode;
  const previewMessages = useMemo(
    () => buildPreviewMessage(hints.initialPrompt),
    [hints.initialPrompt],
  );
  const visibleMessages = share
    ? (share.session.messages as Message[])
    : previewMessages;

  const refresh = useCallback(async () => {
    if (!secret || !relayUsername) {
      throw new Error(t("publicShareMissingRelay"));
    }
    return await fetchPublicShareViaRelay({
      relayUrl,
      relayUsername,
      secret,
    });
  }, [relayUrl, relayUsername, secret, t]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      try {
        const response = await refresh();
        if (cancelled) return;
        setShare(response);
        setError(null);
        setLoading(false);
        setRetrying(false);
        if (response.share.mode === "live") {
          timer = setTimeout(run, LIVE_POLL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setLoading(false);
        if (shouldRetryPublicShareError(err)) {
          setRetrying(true);
          setError(null);
          timer = setTimeout(run, RETRY_POLL_MS);
          return;
        }
        setRetrying(false);
        setError(err instanceof Error ? err.message : t("publicShareUnavailable"));
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [refresh, t]);

  useEffect(() => {
    document.title = title ? `${title} - Public Share` : "Public Share";
  }, [title]);

  const messageList = (
    <MessageList
      messages={visibleMessages}
      provider={share?.session.provider}
    />
  );
  const messageContent = share ? (
    <SessionMetadataProvider
      projectId={share.share.source.projectId}
      projectPath={null}
      sessionId={share.share.source.sessionId}
    >
      {messageList}
    </SessionMetadataProvider>
  ) : (
    messageList
  );

  return (
    <main className="public-share-page">
      <header className="public-share-header">
        <div className="public-share-title-block">
          <div className="public-share-eyebrow-row">
            <BrandWordmark
              variant="full"
              className="public-share-brand-wordmark"
            />
            <span>{t("publicShareEyebrow")}</span>
            {projectName && (
              <>
                <span className="public-share-eyebrow-separator">/</span>
                <span>{projectName}</span>
              </>
            )}
          </div>
          <h1>{title ?? t("publicShareUntitled")}</h1>
          {(loading || retrying) && (
            <div className="public-share-loading-line">
              {retrying ? t("publicShareRetrying") : t("publicShareLoading")}
            </div>
          )}
        </div>
        {mode && (
          <span className="public-share-badge">
            {mode === "live"
              ? t("publicShareLiveBadge")
              : t("publicShareFrozenBadge")}
          </span>
        )}
      </header>
      <section className="public-share-scroll">
        <ToastProvider>
          <SchemaValidationProvider>
            <StreamingMarkdownProvider>
              {error && !retrying && !share ? (
                <div className="public-share-error public-share-error--inline">
                  {error}
                </div>
              ) : visibleMessages.length > 0 ? (
                messageContent
              ) : (
                <div className="public-share-empty">
                  {retrying ? t("publicShareRetrying") : t("publicShareLoading")}
                </div>
              )}
            </StreamingMarkdownProvider>
          </SchemaValidationProvider>
        </ToastProvider>
      </section>
    </main>
  );
}
