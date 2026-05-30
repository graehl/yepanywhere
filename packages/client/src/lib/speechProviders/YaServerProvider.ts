import { fetchJSON } from "../../api/client";
import {
  INITIAL_SPEECH_STATE,
  type SpeechProvider,
  type SpeechProviderOptions,
  type SpeechProviderState,
  type SpeechProviderSubscriber,
} from "./SpeechProvider";

function preferredMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  for (const mime of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(mime)
    ) {
      return mime;
    }
  }
  return "audio/webm";
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

interface TranscribeResponse {
  text: string;
}

/**
 * Speech provider that records audio locally and transcribes it through YA.
 *
 * The first usable server-mediated path is batch-on-stop: MediaRecorder
 * captures Opus/WebM chunks, stop() posts the complete utterance to
 * /api/speech/transcribe, and ordinary YA request transport carries it in
 * both local and remote/SecureConnection modes.
 */
export class YaServerProvider implements SpeechProvider {
  readonly id: string;
  readonly isSupported: boolean;

  private state: SpeechProviderState = { ...INITIAL_SPEECH_STATE };
  private readonly subscribers = new Set<SpeechProviderSubscriber>();
  private readonly options: SpeechProviderOptions;
  private readonly backendId: string;

  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private mimeType = "audio/webm";
  private submitOnStop = false;
  private startToken = 0;
  private disposed = false;

  constructor(
    backendId: string,
    _basePath: string,
    options: SpeechProviderOptions = {},
  ) {
    this.backendId = backendId;
    this.id = `ya-server-${backendId}`;
    this.options = options;
    this.isSupported =
      typeof window !== "undefined" &&
      typeof MediaRecorder !== "undefined" &&
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia;
  }

  getState(): SpeechProviderState {
    return this.state;
  }

  subscribe(subscriber: SpeechProviderSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private setState(patch: Partial<SpeechProviderState>): void {
    this.state = { ...this.state, ...patch };
    for (const sub of this.subscribers) sub(this.state);
  }

  start(): void {
    if (this.disposed) return;
    if (
      this.state.isListening ||
      this.state.status === "starting" ||
      this.state.status === "receiving"
    ) {
      return;
    }
    const token = ++this.startToken;
    this.setState({ status: "starting", isListening: false, error: null });
    this.doStart(token).catch((err: unknown) => {
      if (this.disposed || token !== this.startToken) return;
      this.cleanupMedia(false);
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ status: "error", isListening: false, error: msg });
      this.options.onError?.(msg);
    });
  }

  private async doStart(token: number): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.disposed || token !== this.startToken) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    this.mimeType = preferredMimeType();
    this.chunks = [];
    this.submitOnStop = true;

    const recorder = new MediaRecorder(stream, {
      mimeType: this.mimeType,
      audioBitsPerSecond: 16_000,
    });
    this.recorder = recorder;

    recorder.ondataavailable = (e: BlobEvent) => {
      if (token === this.startToken && this.submitOnStop && e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };
    recorder.onstop = () => {
      if (token === this.startToken && this.submitOnStop) {
        void this.transcribeRecording();
      }
    };

    recorder.start(250); // 250ms chunks
    this.setState({ status: "listening", isListening: true, error: null });
  }

  private async transcribeRecording(): Promise<void> {
    this.submitOnStop = false;
    const audio = new Blob(this.chunks, { type: this.mimeType });
    this.chunks = [];
    this.stopTracks();

    try {
      const response =
        audio.size > 0
          ? await fetchJSON<TranscribeResponse>("/speech/transcribe", {
              method: "POST",
              body: JSON.stringify({
                backendId: this.backendId,
                mimeType: this.mimeType,
                audioBase64: await blobToBase64(audio),
              }),
            })
          : { text: "" };
      if (this.disposed) return;
      this.setState({
        status: "idle",
        isListening: false,
        interimTranscript: "",
        error: null,
      });
      if (response.text) this.options.onResult?.(response.text);
      this.options.onEnd?.();
    } catch (err: unknown) {
      if (this.disposed) return;
      const message = err instanceof Error ? err.message : String(err);
      this.setState({
        status: "error",
        isListening: false,
        interimTranscript: "",
        error: message,
      });
      this.options.onError?.(message);
      this.options.onEnd?.();
    }
  }

  stop(): void {
    if (this.disposed) return;
    if (this.state.status === "starting") {
      this.startToken += 1;
      this.cleanupMedia(false);
      this.setState({
        status: "idle",
        isListening: false,
        interimTranscript: "",
        error: null,
      });
      this.options.onEnd?.();
      return;
    }
    if (!this.state.isListening) return;
    this.setState({ status: "receiving", isListening: false });

    if (this.recorder?.state !== "inactive") {
      this.recorder?.stop();
    } else {
      void this.transcribeRecording();
    }
  }

  private stopTracks(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private cleanupMedia(submitOnStop: boolean): void {
    this.submitOnStop = submitOnStop;
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
    this.recorder = null;
    if (!submitOnStop) {
      this.chunks = [];
      this.stopTracks();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.startToken += 1;
    this.cleanupMedia(false);
    this.setState({ ...INITIAL_SPEECH_STATE });
    this.subscribers.clear();
  }
}
