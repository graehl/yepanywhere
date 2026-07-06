export interface CodexConfigAck {
  model?: string;
  thinking?: { type: string };
  effort?: string;
}

export function parseCodexConfigAck(
  message: { [key: string]: unknown } | null | undefined,
): CodexConfigAck | null {
  if (message?.type !== "system" || message.subtype !== "config_ack") {
    return null;
  }

  const configModel =
    typeof message.configModel === "string" ? message.configModel.trim() : "";
  const configThinking =
    typeof message.configThinking === "string"
      ? message.configThinking.trim().toLowerCase()
      : "";

  const ack: CodexConfigAck = {};

  if (configModel) {
    ack.model = configModel;
  }

  if (configThinking.startsWith("effort ")) {
    const acknowledgedEffort = configThinking.slice("effort ".length).trim();
    if (acknowledgedEffort === "none") {
      ack.thinking = { type: "disabled" };
      ack.effort = "none";
    } else if (acknowledgedEffort) {
      ack.thinking = { type: "enabled" };
      ack.effort = acknowledgedEffort;
    }
  }

  return ack.model || ack.thinking || ack.effort ? ack : null;
}
