import { fetchJSON } from "../../api/client";
import { getServerScoped, LEGACY_KEYS, setServerScoped } from "../storageKeys";

export type XaiSttCredentialSource = "browser-local" | "server-borrowed";

export interface XaiSttCredential {
  apiKey: string;
  source: XaiSttCredentialSource;
}

export type XaiSttStreamingSecretSource =
  | "browser-local"
  | "server-ephemeral";

export interface XaiSttStreamingSecret {
  clientSecret: string;
  expiresAt?: string;
  source: XaiSttStreamingSecretSource;
}

interface XaiClientKeyResponse {
  apiKey?: string;
}

interface XaiClientSecretResponse {
  clientSecret?: string;
  expiresAt?: string;
}

const XAI_STT_KEY_STORAGE = "xaiSttApiKey";

export function getBrowserXaiSttApiKey(): string {
  return (
    getServerScoped(XAI_STT_KEY_STORAGE, LEGACY_KEYS.xaiSttApiKey)?.trim() ?? ""
  );
}

export function setBrowserXaiSttApiKey(apiKey: string): void {
  const trimmed = apiKey.trim();
  setServerScoped(XAI_STT_KEY_STORAGE, trimmed, LEGACY_KEYS.xaiSttApiKey);
}

export async function getXaiSttCredential(): Promise<XaiSttCredential> {
  const browserKey = getBrowserXaiSttApiKey();
  if (browserKey) {
    return { apiKey: browserKey, source: "browser-local" };
  }

  const response = await fetchJSON<XaiClientKeyResponse>(
    "/speech/xai-client-key",
    { method: "POST" },
  );
  const apiKey = response.apiKey?.trim();
  if (!apiKey) {
    throw new Error(
      "No xAI STT key available. Add a browser key in Speech settings or enable server key borrowing.",
    );
  }
  return { apiKey, source: "server-borrowed" };
}

export async function getXaiSttStreamingSecret(): Promise<XaiSttStreamingSecret> {
  const browserKey = getBrowserXaiSttApiKey();
  if (browserKey) {
    return { clientSecret: browserKey, source: "browser-local" };
  }

  const response = await fetchJSON<XaiClientSecretResponse>(
    "/speech/xai-client-secret",
    { method: "POST" },
  );
  const clientSecret = response.clientSecret?.trim();
  if (!clientSecret) {
    throw new Error(
      "No xAI STT streaming secret available. Add a browser key in Speech settings or configure the YA server xAI STT key.",
    );
  }
  return {
    clientSecret,
    expiresAt: response.expiresAt,
    source: "server-ephemeral",
  };
}
