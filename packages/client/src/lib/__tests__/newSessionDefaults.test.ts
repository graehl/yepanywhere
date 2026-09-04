import { describe, expect, it } from "vitest";
import {
  getPreferredModelId,
  getPreferredProviderModelId,
} from "../newSessionDefaults";

describe("getPreferredModelId", () => {
  const models = [
    { id: "latest", name: "Latest" },
    { id: "previous", name: "Previous" },
  ];

  it("uses the first model when no preference is saved", () => {
    expect(getPreferredModelId(models)).toBe("latest");
  });

  it("uses the provider-marked default when it is not first", () => {
    expect(
      getPreferredModelId([
        { id: "preferred-order", name: "Preferred order" },
        { id: "provider-default", name: "Provider default", isDefault: true },
      ]),
    ).toBe("provider-default");
  });

  it("keeps a saved exact id when the current catalog omits it", () => {
    expect(getPreferredModelId(models, "unlisted")).toBe("unlisted");
  });

  it("uses only models advertised by Claude Gateway", () => {
    expect(
      getPreferredProviderModelId("claude-gateway", models, "gpt-5.5"),
    ).toBe("latest");
    expect(
      getPreferredProviderModelId("claude-gateway", [], "gpt-5.5"),
    ).toBeNull();
  });

  it("uses Claude Gateway's advertised default when a saved id is absent", () => {
    expect(
      getPreferredProviderModelId(
        "claude-gateway",
        [
          { id: "first", name: "First" },
          { id: "default", name: "Default", isDefault: true },
        ],
        "missing",
      ),
    ).toBe("default");
  });
});
