# Competitive Landscape

Analysis of similar tools in the AI coding agent supervisor space.

**[Feature Matrix](feature-matrix.md)** — Full checklist comparison across all tools.

## First-Party Tools

Official apps from AI providers:

| Tool | Type | Key Differentiator |
|------|------|-------------------|
| [Codex App](codex-app.md) | macOS + cloud | Cloud sandboxes, automations, GitHub integration |
| [Claude Code Desktop](claude-code-desktop.md) | Desktop (Electron) | Remote execution, Cowork for non-coders |

## Third-Party Tools (Agent Supervisors)

| Tool | Type | Agents | Key Differentiator |
|------|------|--------|-------------------|
| [T3 Code](t3code.md) | Web + desktop + native mobile | Codex, Claude, Cursor, Grok, OpenCode, Antigravity | Integrated workbench, offline mobile, multi-environment remote access, full source-control workflow |
| [AionUi](aionui.md) | Desktop + WebUI + Telegram | 17 (ACP) | Messaging platform bots, cron scheduling, Zed ACP bridges |
| [emdash](emdash.md) | Desktop app | 20+ | Multi-agent orchestration, git worktrees |
| [Conductor](conductor.md) | macOS app | Claude, Codex | Git worktree isolation |
| [HAPI](hapi.md) | Web + CLI | Claude, Codex, Gemini, OpenCode | CLI-wrapper architecture, terminal page |
| [Happy](happy.md) | Mobile + CLI | Claude, Codex | Voice commands, native mobile apps |

See also [Community Projects](community-projects.md) for smaller tools shared on Reddit/forums.

## The "Claw" Ecosystem (Adjacent Category)

"Claw" is now a recognized category term (Karpathy coined it, Willison validated it, Feb 2026) for AI agents that run on personal hardware, communicate via messaging, and schedule autonomous tasks. These are **runtimes that wrap LLM APIs**, not agent supervisors like yepanywhere. But they overlap enough to track.

| Project | Stars | Language | Key Differentiator |
|---------|-------|----------|-------------------|
| [OpenClaw](https://github.com/openclaw/openclaw) | 215k | TypeScript | The original. 38+ channels, 5,700+ skills on ClawHub |
| [Nanobot](https://github.com/HKUDS/nanobot) | 22.4k | Python | ~4K lines. Research-friendly. MCP integration |
| [PicoClaw](https://github.com/sipeed/picoclaw) | 17.2k | Go | <10MB RAM, runs on $10 RISC-V boards |
| [ZeroClaw](https://github.com/zeroclaw-labs/zeroclaw) | 16k | Rust | <5MB RAM, single binary, 22+ providers |
| [NanoClaw](https://github.com/qwibitai/nanoclaw) | 10.2k | TypeScript | Container isolation (Docker/Apple Container) |
| [Moltworker](https://github.com/cloudflare/moltworker) | 8.6k | TypeScript | Serverless on Cloudflare Workers |
| [IronClaw](https://github.com/nearai/ironclaw) | 2.6k | Rust | WASM sandboxing, PostgreSQL, defense-in-depth |

**Why we're different:** Claws are runtimes — they manage LLM API calls, tool execution, and session state. We're a supervisor/relay — we manage existing agents (Claude Code, Codex) that handle their own execution. See the [Seneschal competitive analysis](../../../assistant-data/assistants/scout/docs/seneschal-ideas.md) for detailed positioning.

## Common Features Across Competitors

Most tools in this space provide:
- Multi-session dashboard
- Real-time streaming
- Permission approval UI
- Session persistence

## yepanywhere Differentiators

The combination that most clearly distinguishes yepanywhere:

- **Tiered inbox** (Needs Attention → Active → Recent → Unread) across
  YA-owned and externally discovered provider sessions
- **Conversation fork/clone** from a selected completed user turn
- **Provider-native history discovery** rather than a product-only thread silo
- **Global activity stream** across sessions
- **Reload-safe provider runtimes** that can survive a Hono server replacement
- **App-data-only storage by default** — browsing and indexing do not create
  project directories or Git refs
- **Application-layer E2E relay encryption** (Happy and Paseo also use E2E;
  T3 Connect does not appear to)
- **Alternate/local provider variants** including Codex OSS/local, Gemini, and
  Claude gateway/Ollama configurations

## Common Gaps

Features competitors have that we should consider:

- **Git worktree creation and exact workspace rollback** per session
- **Integrated terminal/browser and full forge workflows** (T3 Code)
- **Native iOS and offline mobile outbox** (T3 Code, Happy)
- **Multiple provider-account instances** with explicit resume rules (T3 Code)
- **Scheduling/automations** (Codex App, AionUi)
- **Messaging platform bots** as mobile proxy (AionUi — Telegram/Lark/DingTalk)

## Related (Non-Competitive)

See **[Ecosystem](../ecosystem/)** for adjacent projects — agent-to-agent coordination, workflow DAG platforms, multi-agent orchestrators — that aren't direct competitors but operate in complementary spaces.

## Last Updated

2026-09-04
