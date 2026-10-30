import {
  thinkingOptionToConfig,
  type UrlProjectId,
} from "@yep-anywhere/shared";
import type { Supervisor } from "../supervisor/Supervisor.js";
import type { SessionCommandOwner } from "./session-commands.js";

/** Uses the same native owner/admission/options as the legacy session routes. */
export function nativeSessionCommandOwner(deps: {
  supervisor: Pick<Supervisor, "startSession" | "getAllProcesses">;
  globalInstructions: () => string | undefined;
}): SessionCommandOwner {
  return {
    async recover(receipt) {
      const processes = deps.supervisor.getAllProcesses();
      if (processes.length > 256) return;
      const candidates = processes.filter(
        (process) =>
          !process.isTerminated &&
          process
            .getMessageHistory()
            .some(
              (message) =>
                message.type === "user" &&
                (message.uuid === receipt.id || message.tempId === receipt.id),
            ),
      );
      return candidates.length === 1
        ? { sessionId: candidates[0]!.sessionId }
        : undefined;
    },
    async start(project, request, receipt, settled, failed) {
      const thinking = request.thinking
        ? thinkingOptionToConfig(request.thinking)
        : { thinking: undefined, effort: undefined };
      const result = await deps.supervisor.startSession(
        project.path,
        {
          text: request.message,
          uuid: receipt.id,
          tempId: receipt.id,
          metadata: {
            origin: "coordination",
            sourceSessionId: receipt.creator.sessionId ?? undefined,
            serverReceivedAt: receipt.createdAt,
          },
        },
        request.permissionMode,
        {
          providerName: request.provider,
          model: request.model === "default" ? undefined : request.model,
          requestedModel: request.model,
          ...thinking,
          serviceTier: request.serviceTier,
          globalInstructions: deps.globalInstructions(),
          recapMode: "off",
          promptSuggestionMode: "off",
        },
        {
          projectId: project.id as UrlProjectId,
          requireProviderSessionId: true,
          onStarted: (id) => settled(id),
          onFailed: failed,
          onRetryableFailure: failed,
        },
      );
      if ("error" in result) return { rejected: true };
      if ("queued" in result) return { queueId: result.queueId };
      return { sessionId: result.sessionId };
    },
  };
}
