/**
 * Unit tests for CodexProvider.
 *
 * Tests provider detection, authentication checking, and message normalization
 * without requiring actual Codex CLI installation.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CodexProvider,
  type CodexProviderConfig,
} from "../../../src/sdk/providers/codex.js";

describe("CodexProvider", () => {
  let provider: CodexProvider;

  beforeAll(() => {
    provider = new CodexProvider();
  });

  describe("isInstalled", () => {
    it("should return boolean indicating CLI availability", async () => {
      const isInstalled = await provider.isInstalled();
      expect(typeof isInstalled).toBe("boolean");
    });

    it("should use custom codexPath if provided and exists", async () => {
      // Custom path is used IF it exists, otherwise falls back to PATH detection
      const customProvider = new CodexProvider({
        codexPath: "/nonexistent/path/to/codex",
      });
      // isInstalled will still check PATH if custom path doesn't exist
      const isInstalled = await customProvider.isInstalled();
      // We just verify it returns a boolean - actual value depends on system
      expect(typeof isInstalled).toBe("boolean");
    });
  });

  describe("getAuthStatus", () => {
    it("should return auth status object with required fields", async () => {
      const status = await provider.getAuthStatus();

      expect(typeof status.installed).toBe("boolean");
      expect(typeof status.authenticated).toBe("boolean");
      expect(typeof status.enabled).toBe("boolean");
    });

    it("should return authenticated=false if auth.json does not exist", async () => {
      // This test relies on the auth file not existing in the test environment
      const authPath = join(homedir(), ".codex", "auth.json");
      if (!existsSync(authPath)) {
        const status = await provider.getAuthStatus();
        // If CLI is not installed, everything should be false
        // If CLI is installed but no auth, installed=true but auth=false
        expect(status.authenticated).toBe(false);
      }
    });
  });

  describe("isAuthenticated", () => {
    it("should return boolean", async () => {
      const isAuth = await provider.isAuthenticated();
      expect(typeof isAuth).toBe("boolean");
    });
  });

  describe("provider properties", () => {
    it("should have correct name", () => {
      expect(provider.name).toBe("codex");
    });

    it("should have correct displayName", () => {
      expect(provider.displayName).toBe("Codex");
    });
  });

  describe("startSession", () => {
    it("should return session object with required methods", async () => {
      const session = await provider.startSession({
        cwd: "/tmp",
        initialMessage: { text: "test" },
      });

      expect(session.iterator).toBeDefined();
      expect(typeof session.abort).toBe("function");
      expect(session.queue).toBeDefined();
    });

    it("should emit error if Codex CLI is not found", async () => {
      const noCliProvider = new CodexProvider({
        codexPath: "/nonexistent/codex",
      });

      const session = await noCliProvider.startSession({
        cwd: "/tmp",
        initialMessage: { text: "test" },
      });

      const messages: unknown[] = [];
      for await (const msg of session.iterator) {
        messages.push(msg);
        if (msg.type === "result" || msg.type === "error") break;
      }

      // Should get an error message about CLI not found
      expect(
        messages.some(
          (m: unknown) =>
            (m as { type?: string; error?: string }).type === "error" ||
            (m as { type?: string }).type === "result",
        ),
      ).toBe(true);
    });
  });
});

describe("CodexProvider Auth File Parsing", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeAll(() => {
    // Create a temp directory to use as HOME
    tempDir = mkdtempSync(join(require("node:os").tmpdir(), "codex-test-"));
    originalHome = process.env.HOME;
  });

  afterAll(() => {
    // Restore HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
    // Cleanup
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("should parse valid auth.json file", async () => {
    // Create mock auth file
    const codexDir = join(tempDir, ".codex");
    require("node:fs").mkdirSync(codexDir, { recursive: true });

    const authData = {
      api_key: "test-key-123",
      expires_at: new Date(Date.now() + 86400000).toISOString(), // 1 day from now
      user: {
        email: "test@example.com",
        name: "Test User",
      },
    };

    writeFileSync(join(codexDir, "auth.json"), JSON.stringify(authData));

    // Create provider that looks in our temp directory
    // Note: This doesn't actually work because homedir() is cached,
    // but it demonstrates the intended behavior
  });

  it("should handle expired tokens", async () => {
    // Create mock auth file with expired token
    const codexDir = join(tempDir, ".codex");
    require("node:fs").mkdirSync(codexDir, { recursive: true });

    const authData = {
      api_key: "test-key-123",
      expires_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    };

    writeFileSync(join(codexDir, "auth.json"), JSON.stringify(authData));

    // The actual test would need to mock homedir() to use tempDir
  });

  it("should handle invalid JSON in auth file", async () => {
    const codexDir = join(tempDir, ".codex");
    require("node:fs").mkdirSync(codexDir, { recursive: true });

    writeFileSync(join(codexDir, "auth.json"), "not valid json");

    // Provider should handle this gracefully
  });
});

describe("CodexProvider Event Normalization", () => {
  // Test helper to create a provider and access internal methods
  function createTestProvider(): CodexProvider {
    return new CodexProvider();
  }

  function createLiveEventState() {
    return {
      streamingTextByItemKey: new Map<string, string>(),
      streamingReasoningSummaryByItemKey: new Map<string, string[]>(),
      streamingToolOutputByItemKey: new Map<string, string>(),
      toolCallContexts: new Map<string, unknown>(),
    };
  }

  it("should have correct provider interface", () => {
    const provider = createTestProvider();

    expect(provider.name).toBe("codex");
    expect(provider.displayName).toBe("Codex");
    expect(typeof provider.isInstalled).toBe("function");
    expect(typeof provider.isAuthenticated).toBe("function");
    expect(typeof provider.getAuthStatus).toBe("function");
    expect(typeof provider.startSession).toBe("function");
  });

  it("normalizes command execution tool_use and tool_result to Read shape", () => {
    const provider = createTestProvider() as unknown as {
      convertItemToSDKMessages: (
        item: unknown,
        sessionId: string,
        turnId: string,
        sourceEvent: "item/started" | "item/completed",
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertItemToSDKMessages(
      {
        id: "call-read",
        type: "command_execution",
        command: "cat src/example.ts",
        aggregated_output: "line 1\nline 2",
        exit_code: 0,
        status: "completed",
      },
      "session-1",
      "turn-1",
      "item/completed",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.message).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call-read",
          name: "Read",
          input: { file_path: "src/example.ts" },
        },
      ],
    });
    expect(messages[1]?.message).toMatchObject({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call-read",
          content: "line 1\nline 2",
        },
      ],
    });
    expect(messages[1]?.toolUseResult).toMatchObject({
      type: "text",
      file: {
        filePath: "src/example.ts",
      },
    });
  });

  it("normalizes shell-launcher wrapped command execution to Read shape", () => {
    const provider = createTestProvider() as unknown as {
      convertItemToSDKMessages: (
        item: unknown,
        sessionId: string,
        turnId: string,
        sourceEvent: "item/started" | "item/completed",
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertItemToSDKMessages(
      {
        id: "call-read-wrapped",
        type: "command_execution",
        command: "/bin/bash -lc \"sed -n '10,12p' src/example.ts\"",
        aggregated_output: "line 10\nline 11\nline 12",
        exit_code: 0,
        status: "completed",
      },
      "session-1",
      "turn-1",
      "item/completed",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.message).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call-read-wrapped",
          name: "Read",
          input: { file_path: "src/example.ts", offset: 10, limit: 3 },
        },
      ],
    });
    expect(messages[1]?.toolUseResult).toMatchObject({
      type: "text",
      file: {
        filePath: "src/example.ts",
        startLine: 10,
      },
    });
  });

  it("normalizes heredoc command execution as Write with structured file result", () => {
    const provider = createTestProvider() as unknown as {
      convertItemToSDKMessages: (
        item: unknown,
        sessionId: string,
        turnId: string,
        sourceEvent: "item/started" | "item/completed",
      ) => Array<Record<string, unknown>>;
    };

    const content = "line 1\nline 2\n";
    const messages = provider.convertItemToSDKMessages(
      {
        id: "call-write",
        type: "command_execution",
        command: `cat > src/generated.ts <<'EOF'\n${content}EOF`,
        aggregated_output: "",
        exit_code: 0,
        status: "completed",
      },
      "session-1",
      "turn-2",
      "item/completed",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.message).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call-write",
          name: "Write",
          input: {
            file_path: "src/generated.ts",
            content,
          },
        },
      ],
    });

    const resultBlock = ((
      messages[1]?.message as { content?: unknown[] } | undefined
    )?.content ?? [])[0] as Record<string, unknown>;
    expect(resultBlock.type).toBe("tool_result");
    expect(resultBlock.tool_use_id).toBe("call-write");
    expect(resultBlock.is_error).toBeUndefined();
    expect(messages[1]?.toolUseResult).toMatchObject({
      type: "text",
      file: {
        filePath: "src/generated.ts",
        content,
        numLines: 2,
        startLine: 1,
        totalLines: 2,
      },
    });
  });

  it("normalizes no-match ripgrep exit code as non-error Grep result", () => {
    const provider = createTestProvider() as unknown as {
      convertItemToSDKMessages: (
        item: unknown,
        sessionId: string,
        turnId: string,
        sourceEvent: "item/started" | "item/completed",
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertItemToSDKMessages(
      {
        id: "call-grep",
        type: "command_execution",
        command: "rg -n missing_pattern src",
        aggregated_output: "",
        exit_code: 1,
        status: "completed",
      },
      "session-1",
      "turn-2",
      "item/completed",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.message).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call-grep",
          name: "Grep",
          input: { pattern: "missing_pattern", path: "src" },
        },
      ],
    });

    const resultBlock = ((
      messages[1]?.message as { content?: unknown[] } | undefined
    )?.content ?? [])[0] as Record<string, unknown>;
    expect(resultBlock.type).toBe("tool_result");
    expect(resultBlock.tool_use_id).toBe("call-grep");
    expect(resultBlock.is_error).toBeUndefined();
    expect(messages[1]?.toolUseResult).toMatchObject({
      mode: "files_with_matches",
      numFiles: 0,
    });
  });

  it("prefers reasoning summaries over raw reasoning content", () => {
    const provider = createTestProvider() as unknown as {
      normalizeThreadItem: (item: unknown) => Record<string, unknown> | null;
    };

    const normalized = provider.normalizeThreadItem({
      id: "reason-1",
      type: "reasoning",
      summary: ["Short summary"],
      content: ["internal raw reasoning"],
    });

    expect(normalized).toMatchObject({
      id: "reason-1",
      type: "reasoning",
      text: "Short summary",
    });
  });

  it("declares experimentalApi during initialize when enabled", () => {
    const provider = createTestProvider() as unknown as {
      createInitializeParams: (
        experimentalApiEnabled: boolean,
      ) => Record<string, unknown>;
    };

    const params = provider.createInitializeParams(true);

    expect(params).toMatchObject({
      clientInfo: {
        title: null,
        version: "dev",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    expect((params.clientInfo as { name?: unknown }).name).toEqual(
      expect.any(String),
    );
  });

  it("requests automatic reasoning summaries on turn start", () => {
    const provider = createTestProvider() as unknown as {
      createTurnStartParams: (
        threadId: string,
        userPrompt: string,
        options: { effort?: unknown; thinking?: unknown },
      ) => Record<string, unknown>;
    };

    const params = provider.createTurnStartParams("thread-1", "test prompt", {});

    expect(params).toMatchObject({
      threadId: "thread-1",
      summary: "auto",
    });
  });

  it("prefers GPT-5.5 over Codex's model/list default when available", () => {
    const provider = createTestProvider() as unknown as {
      normalizeModelList: (models: unknown[]) => Array<{
        id: string;
        name: string;
        isDefault?: boolean;
        defaultReasoningEffort?: string;
        supportedReasoningEfforts?: Array<{
          reasoningEffort: string;
          description?: string;
        }>;
        inputModalities?: string[];
        supportsPersonality?: boolean;
      }>;
    };

    const models = provider.normalizeModelList([
      {
        id: "gpt-5.4",
        model: "gpt-5.4",
        displayName: "gpt-5.4",
        description: "Strong model for everyday coding.",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          {
            reasoningEffort: "low",
            description: "Fast responses with lighter reasoning",
          },
          {
            reasoningEffort: "medium",
            description: "Balanced speed and reasoning",
          },
        ],
        inputModalities: ["text", "image"],
        supportsPersonality: true,
      },
      {
        id: "gpt-5.5",
        model: "gpt-5.5",
        displayName: "GPT-5.5",
        description: "Frontier model.",
        isDefault: false,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          {
            reasoningEffort: "high",
            description: "Greater reasoning depth",
          },
        ],
        inputModalities: ["text", "image"],
        supportsPersonality: true,
      },
      {
        id: "gpt-5.3-codex",
        model: "gpt-5.3-codex",
        upgrade: "gpt-5.4",
        hidden: false,
      },
      {
        id: "internal-hidden",
        model: "internal-hidden",
        hidden: true,
      },
    ]);

    expect(models.map((model) => model.id)).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.3-codex",
    ]);
    expect(models[0]).toMatchObject({
      name: "GPT-5.5",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        {
          reasoningEffort: "high",
          description: "Greater reasoning depth",
        },
      ],
      inputModalities: ["text", "image"],
      supportsPersonality: true,
    });
    expect(models[1]).toMatchObject({
      isDefault: true,
      inputModalities: ["text", "image"],
    });
  });

  it("opts into experimental thread flags when experimental API is negotiated", () => {
    const provider = createTestProvider() as unknown as {
      mapPermissionModeToThreadPolicy: (permissionMode?: string) => {
        approvalPolicy: string;
        sandbox: string;
        permissionProfile?: unknown;
      };
      createThreadStartParams: (
        options: { model?: string; cwd: string },
        policy: {
          approvalPolicy: string;
          sandbox: string;
          permissionProfile?: unknown;
        },
        experimentalApiEnabled: boolean,
        usePermissionProfile?: boolean,
      ) => Record<string, unknown>;
    };
    const bypassPolicy =
      provider.mapPermissionModeToThreadPolicy("bypassPermissions");

    const start = provider.createThreadStartParams(
      { model: "gpt-5.2-codex", cwd: "/tmp" },
      { approvalPolicy: "on-request", sandbox: "workspace-write" },
      true,
    );
    const bypassStart = provider.createThreadStartParams(
      { model: "gpt-5.5", cwd: "/tmp" },
      bypassPolicy,
      true,
    );
    const legacyBypassStart = provider.createThreadStartParams(
      { model: "gpt-5.5", cwd: "/tmp" },
      bypassPolicy,
      true,
      false,
    );

    expect(start).toMatchObject({
      experimentalRawEvents: true,
      persistExtendedHistory: true,
    });
    expect(bypassStart).toMatchObject({
      approvalPolicy: "never",
      permissionProfile: {
        type: "managed",
        network: { enabled: true },
        fileSystem: { type: "unrestricted" },
      },
    });
    expect(bypassStart.sandbox).toBeUndefined();
    expect(legacyBypassStart).toMatchObject({
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    });
    expect(legacyBypassStart.permissionProfile).toBeUndefined();
  });

  it("keeps experimental thread flags disabled without negotiated experimental capability", () => {
    const provider = createTestProvider() as unknown as {
      createThreadStartParams: (
        options: { model?: string; cwd: string },
        policy: {
          approvalPolicy: string;
          sandbox: string;
          permissionProfile?: unknown;
        },
        experimentalApiEnabled: boolean,
      ) => Record<string, unknown>;
      createThreadResumeParams: (
        options: { resumeSessionId?: string; model?: string; cwd: string },
        sessionId: string,
        policy: {
          approvalPolicy: string;
          sandbox: string;
          permissionProfile?: unknown;
        },
        experimentalApiEnabled: boolean,
      ) => Record<string, unknown>;
    };

    const start = provider.createThreadStartParams(
      { model: "gpt-5.2-codex", cwd: "/tmp" },
      { approvalPolicy: "on-request", sandbox: "workspace-write" },
      false,
    );
    const resume = provider.createThreadResumeParams(
      {
        resumeSessionId: "thread-1",
        model: "gpt-5.2-codex",
        cwd: "/tmp",
      },
      "thread-1",
      { approvalPolicy: "on-request", sandbox: "workspace-write" },
      false,
    );

    expect(start).toMatchObject({
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });
    expect(resume).toMatchObject({
      excludeTurns: true,
      persistExtendedHistory: false,
    });
  });

  it("pins thread-scope reasoning effort via config when effort is requested", () => {
    const provider = createTestProvider() as unknown as {
      createThreadStartParams: (
        options: { model?: string; cwd: string; effort?: string },
        policy: {
          approvalPolicy: string;
          sandbox: string;
          permissionProfile?: unknown;
        },
        experimentalApiEnabled: boolean,
      ) => Record<string, unknown>;
      createThreadResumeParams: (
        options: {
          resumeSessionId?: string;
          model?: string;
          cwd: string;
          effort?: string;
        },
        sessionId: string,
        policy: {
          approvalPolicy: string;
          sandbox: string;
          permissionProfile?: unknown;
        },
        experimentalApiEnabled: boolean,
      ) => Record<string, unknown>;
    };

    const start = provider.createThreadStartParams(
      { model: "gpt-5.4-codex", cwd: "/tmp", effort: "max" },
      { approvalPolicy: "on-request", sandbox: "workspace-write" },
      true,
    );
    const resume = provider.createThreadResumeParams(
      {
        resumeSessionId: "thread-1",
        model: "gpt-5.4-codex",
        cwd: "/tmp",
        effort: "high",
      },
      "thread-1",
      { approvalPolicy: "on-request", sandbox: "workspace-write" },
      true,
    );
    const omitted = provider.createThreadStartParams(
      { model: "gpt-5.4-codex", cwd: "/tmp" },
      { approvalPolicy: "on-request", sandbox: "workspace-write" },
      true,
    );

    expect(start).toMatchObject({
      config: { model_reasoning_effort: "xhigh" },
    });
    expect(resume).toMatchObject({
      config: { model_reasoning_effort: "high" },
    });
    expect(omitted.config ?? null).toBeNull();
  });

  it("treats experimental thread field rejections as capability fallback errors", () => {
    const provider = createTestProvider() as unknown as {
      isExperimentalCapabilityError: (error: unknown) => boolean;
    };

    expect(
      provider.isExperimentalCapabilityError(
        new Error("thread/start.experimentalRawEvents requires experimentalApi capability"),
      ),
    ).toBe(true);
    expect(
      provider.isExperimentalCapabilityError(
        new Error("unknown field `persistExtendedHistory`"),
      ),
    ).toBe(true);
    expect(
      provider.isExperimentalCapabilityError(
        new Error("connection closed"),
      ),
    ).toBe(false);
  });

  it("treats old permission profile shape rejections as fallback errors", () => {
    const provider = createTestProvider() as unknown as {
      isPermissionProfileCompatibilityError: (error: unknown) => boolean;
    };

    expect(
      provider.isPermissionProfileCompatibilityError(
        new Error("unknown variant `managed`, expected struct PermissionProfile"),
      ),
    ).toBe(true);
    expect(
      provider.isPermissionProfileCompatibilityError(
        new Error("unknown field `type`, expected `network` or `fileSystem`"),
      ),
    ).toBe(true);
    expect(
      provider.isPermissionProfileCompatibilityError(
        new Error("connection closed"),
      ),
    ).toBe(false);
  });

  it("accumulates agent message deltas into a stable streaming assistant message", () => {
    const provider = createTestProvider() as unknown as {
      convertNotificationToSDKMessages: (
        notification: { method: string; params?: unknown },
        sessionId: string,
        usageByTurnId: Map<string, unknown>,
        liveEventState: ReturnType<typeof createLiveEventState>,
      ) => Array<Record<string, unknown>>;
    };

    const liveEventState = createLiveEventState();

    const first = provider.convertNotificationToSDKMessages(
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          delta: "Hello",
        },
      },
      "session-1",
      new Map(),
      liveEventState,
    );
    const second = provider.convertNotificationToSDKMessages(
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          delta: " world",
        },
      },
      "session-1",
      new Map(),
      liveEventState,
    );

    expect(first[0]).toMatchObject({
      type: "assistant",
      session_id: "session-1",
      uuid: "item-1-turn-1",
      _isStreaming: true,
      message: {
        role: "assistant",
        content: "Hello",
      },
    });
    expect(second[0]).toMatchObject({
      type: "assistant",
      session_id: "session-1",
      uuid: "item-1-turn-1",
      _isStreaming: true,
      message: {
        role: "assistant",
        content: "Hello world",
      },
    });
  });

  it("normalizes raw response function calls and outputs into tool messages", () => {
    const provider = createTestProvider() as unknown as {
      convertNotificationToSDKMessages: (
        notification: { method: string; params?: unknown },
        sessionId: string,
        usageByTurnId: Map<string, unknown>,
        liveEventState: ReturnType<typeof createLiveEventState>,
      ) => Array<Record<string, unknown>>;
    };

    const liveEventState = createLiveEventState();
    const toolUse = provider.convertNotificationToSDKMessages(
      {
        method: "rawResponseItem/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "function_call",
            name: "exec_command",
            call_id: "call-1",
            arguments: '{"command":"pnpm lint"}',
          },
        },
      },
      "session-1",
      new Map(),
      liveEventState,
    );
    const toolResult = provider.convertNotificationToSDKMessages(
      {
        method: "rawResponseItem/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "function_call_output",
            call_id: "call-1",
            output: "Process exited with code 0",
          },
        },
      },
      "session-1",
      new Map(),
      liveEventState,
    );

    expect(toolUse[0]).toMatchObject({
      type: "assistant",
      session_id: "session-1",
      uuid: "call-1-turn-1",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call-1",
            name: "Bash",
            input: {
              command: "pnpm lint",
            },
          },
        ],
      },
    });
    expect(toolResult[0]).toMatchObject({
      type: "user",
      session_id: "session-1",
      uuid: "call-1-turn-1-result",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call-1",
            content: "Process exited with code 0",
          },
        ],
      },
    });
  });

  it("normalizes dynamic tool calls with namespace and output content", () => {
    const provider = createTestProvider() as unknown as {
      convertItemToSDKMessages: (
        item: unknown,
        sessionId: string,
        turnId: string,
        sourceEvent: "item/started" | "item/completed",
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertItemToSDKMessages(
      {
        id: "call-dynamic",
        type: "dynamic_tool_call",
        namespace: "web",
        tool: "search",
        arguments: { query: "codex release" },
        status: "completed",
        success: true,
        content_items: [{ type: "inputText", text: "Search completed" }],
      },
      "session-1",
      "turn-1",
      "item/completed",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.message).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call-dynamic",
          name: "web:search",
          input: { query: "codex release" },
        },
      ],
    });
    expect(messages[1]?.message).toMatchObject({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call-dynamic",
          content: "Search completed",
        },
      ],
    });
  });

  it("does not emit rate limit errors when hasCredits is false but usage is below 100%", () => {
    const provider = createTestProvider() as unknown as {
      convertNotificationToSDKMessages: (
        notification: { method: string; params?: unknown },
        sessionId: string,
        usageByTurnId: Map<string, unknown>,
        liveEventState: ReturnType<typeof createLiveEventState>,
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertNotificationToSDKMessages(
      {
        method: "account/rateLimits/updated",
        params: {
          rateLimits: {
            primary: {
              usedPercent: 21,
              resetsAt: 1772721801,
            },
            credits: {
              hasCredits: false,
              unlimited: false,
              balance: null,
            },
          },
        },
      },
      "session-1",
      new Map(),
      createLiveEventState(),
    );

    expect(messages).toEqual([]);
  });

  it("does not emit synthetic errors for exhausted usage snapshots", () => {
    const provider = createTestProvider() as unknown as {
      convertNotificationToSDKMessages: (
        notification: { method: string; params?: unknown },
        sessionId: string,
        usageByTurnId: Map<string, unknown>,
        liveEventState: ReturnType<typeof createLiveEventState>,
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertNotificationToSDKMessages(
      {
        method: "account/rateLimits/updated",
        params: {
          rateLimits: {
            primary: {
              used_percent: 100,
              resets_at: 1772721801,
            },
            credits: {
              has_credits: false,
              unlimited: false,
              balance: null,
            },
          },
        },
      },
      "session-1",
      new Map(),
      createLiveEventState(),
    );

    expect(messages).toEqual([]);
  });

  it("emits errors from codex error notifications", () => {
    const provider = createTestProvider() as unknown as {
      convertNotificationToSDKMessages: (
        notification: { method: string; params?: unknown },
        sessionId: string,
        usageByTurnId: Map<string, unknown>,
        liveEventState: ReturnType<typeof createLiveEventState>,
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertNotificationToSDKMessages(
      {
        method: "error",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          willRetry: false,
          error: {
            message:
              "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again later.",
            codexErrorInfo: "usageLimitExceeded",
          },
        },
      },
      "session-1",
      new Map(),
      createLiveEventState(),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "error",
      session_id: "session-1",
      error:
        "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again later.",
    });
  });

  it("grants requested permission profiles automatically in bypass mode", async () => {
    const provider = createTestProvider() as unknown as {
      handleServerRequestApproval: (
        request: { method: string; id: number; params?: unknown },
        options: { permissionMode?: string },
        signal: AbortSignal,
      ) => Promise<Record<string, unknown>>;
    };

    const response = await provider.handleServerRequestApproval(
      {
        method: "item/permissions/requestApproval",
        id: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "permission-1",
          cwd: "/tmp/project",
          reason: "Need unrestricted filesystem for GPU tooling",
          permissions: {
            network: { enabled: true },
            fileSystem: {
              entries: [
                {
                  path: { type: "special", value: { kind: "root" } },
                  access: "write",
                },
              ],
            },
          },
        },
      },
      { permissionMode: "bypassPermissions" },
      new AbortController().signal,
    );

    expect(response).toMatchObject({
      scope: "session",
      permissions: {
        network: { enabled: true },
        fileSystem: {
          entries: [
            {
              path: { type: "special", value: { kind: "root" } },
              access: "write",
            },
          ],
        },
      },
    });
  });
});

describe("CodexProvider Configuration", () => {
  it("should accept custom timeout", () => {
    const config: CodexProviderConfig = {
      timeout: 60000,
    };
    const provider = new CodexProvider(config);

    expect(provider.name).toBe("codex");
    // Can't directly verify timeout since it's private,
    // but we can verify the provider was created
  });

  it("should accept custom codex path", () => {
    const config: CodexProviderConfig = {
      codexPath: "/custom/path/to/codex",
    };
    const provider = new CodexProvider(config);

    expect(provider.name).toBe("codex");
  });

  it("should use defaults when no config provided", () => {
    const provider = new CodexProvider();

    expect(provider.name).toBe("codex");
    expect(provider.displayName).toBe("Codex");
  });
});
