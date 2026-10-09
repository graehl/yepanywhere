import type { Page } from "@playwright/test";

/** Hold selected parts at the browser's streaming-response boundary. */
export async function holdNewSessionBootstrap(page: Page, parts: string[]) {
  await page.addInitScript((parts) => {
    const gates = new Map(
      parts.map((part) => {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => {
          release = resolve;
        });
        return [part, { promise, release }] as const;
      }),
    );
    const state = {
      delivered: [] as string[],
      release(part?: string) {
        if (part) gates.get(part)?.release();
        else for (const gate of gates.values()) gate.release();
      },
    };
    Object.assign(window, { yaBootstrapTest: state });
    const fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);
      if (
        !url.includes("bootstrap=new-session-v1") ||
        !response.headers.get("Content-Type")?.includes("text/event-stream") ||
        !response.body
      )
        return response;
      const reader = response.body.getReader();
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const pump = async () => {
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            const deliveries: Promise<void>[] = [];
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
                  if (!data)
                    throw new Error("Bootstrap test received a non-data event");
                  const part = (JSON.parse(data.slice(6)) as { part: string })
                    .part;
                  deliveries.push(
                    (gates.get(part)?.promise ?? Promise.resolve()).then(() => {
                      if (cancelled) return;
                      controller.enqueue(encoder.encode(`${event}\n\n`));
                      state.delivered.push(part);
                    }),
                  );
                  end = buffer.indexOf("\n\n");
                }
              }
              if (buffer)
                throw new Error("Bootstrap test received an incomplete event");
              await Promise.all(deliveries);
              if (!cancelled) controller.close();
            } finally {
              await reader.cancel();
              reader.releaseLock();
            }
          };
          void pump().catch((error) => {
            if (!cancelled) controller.error(error);
          });
        },
        cancel() {
          cancelled = true;
          state.release();
          return reader.cancel();
        },
      });
      return new Response(body, {
        status: response.status,
        headers: response.headers,
      });
    };
  }, parts);
  return {
    release: (part?: string) =>
      page.evaluate((part) => {
        (
          window as unknown as {
            yaBootstrapTest?: { release(part?: string): void };
          }
        ).yaBootstrapTest?.release(part);
      }, part),
    wait: (part: string) =>
      page.waitForFunction(
        (part) =>
          (
            window as unknown as { yaBootstrapTest: { delivered: string[] } }
          ).yaBootstrapTest.delivered.includes(part),
        part,
      ),
  };
}
