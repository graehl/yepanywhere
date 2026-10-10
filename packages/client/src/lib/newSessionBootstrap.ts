import {
  NEW_SESSION_BOOTSTRAP,
  NEW_SESSION_BOOTSTRAP_PARTS,
  type NewSessionBootstrapFrame,
  type NewSessionBootstrapPart,
} from "@yep-anywhere/shared";
import { fetchPlainResponse, readPlainJSONResponse } from "../api/plainFetch";

/** One finite route bundle; older servers return their ordinary settings JSON. */
export function createNewSessionBootstrap(
  preferredProvider: string | undefined,
  fetchResponse: typeof fetchPlainResponse = fetchPlainResponse,
) {
  const path = `/settings?bootstrap=${NEW_SESSION_BOOTSTRAP}${preferredProvider ? `&provider=${encodeURIComponent(preferredProvider)}` : ""}`;
  const pending = new Map(
    NEW_SESSION_BOOTSTRAP_PARTS.map((part) => {
      let resolve!: (frame: NewSessionBootstrapFrame) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<NewSessionBootstrapFrame>((accept, fail) => {
        resolve = accept;
        reject = fail;
      });
      // Settings failure can prevent a provider consumer from ever mounting.
      void promise.catch(() => {});
      return [part, { promise, resolve, reject }] as const;
    }),
  );
  const negotiate = () =>
    fetchResponse(path, { headers: { Accept: "text/event-stream" } }).then(
      async (result) => {
        if (result.headers.get("Content-Type")?.includes("application/json")) {
          return {
            kind: "legacy" as const,
            settings: await readPlainJSONResponse<unknown>("/settings", result),
          };
        }
        if (
          !result.headers.get("Content-Type")?.includes("text/event-stream") ||
          !result.body
        ) {
          throw new Error(
            "New Session bootstrap returned an unsupported response",
          );
        }
        const reader = result.body.getReader();
        const consume = async () => {
          const decoder = new TextDecoder();
          const received = new Set<NewSessionBootstrapPart>();
          let buffer = "";
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              buffer += decoder.decode(chunk.value, { stream: true });
              let end = buffer.indexOf("\n\n");
              while (end !== -1) {
                const event = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                const data = event
                  .split("\n")
                  .find((line) => line.startsWith("data: "));
                if (!event.startsWith("event: bootstrap\n") || !data)
                  throw new Error("Invalid New Session bootstrap event");
                const frame = JSON.parse(
                  data.slice(6),
                ) as NewSessionBootstrapFrame;
                if (
                  !frame ||
                  !pending.has(frame.part) ||
                  received.has(frame.part) ||
                  !Number.isInteger(frame.status) ||
                  frame.status < 200 ||
                  frame.status > 599 ||
                  !("body" in frame)
                ) {
                  throw new Error("Invalid New Session bootstrap frame");
                }
                received.add(frame.part);
                pending.get(frame.part)!.resolve(frame);
                end = buffer.indexOf("\n\n");
              }
            }
            if (buffer || received.size !== pending.size)
              throw new Error(
                "New Session bootstrap ended before every part arrived",
              );
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
        };
        void consume().catch((error: unknown) => {
          for (const part of pending.values()) part.reject(error);
        });
        return { kind: "stream" as const };
      },
    );
  let response: ReturnType<typeof negotiate> | undefined;
  return {
    async read<T>(
      part: NewSessionBootstrapPart,
      legacy: () => Promise<T>,
    ): Promise<T> {
      response ??= negotiate();
      const protocol = await response;
      if (protocol.kind === "legacy")
        return part === "settings" ? (protocol.settings as T) : legacy();
      const frame = await pending.get(part)!.promise;
      return readPlainJSONResponse<T>(
        path,
        Response.json(frame.body, { status: frame.status }),
      );
    },
  };
}
