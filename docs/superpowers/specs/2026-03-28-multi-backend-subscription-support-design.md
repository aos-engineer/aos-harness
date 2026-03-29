# Multi-Backend Subscription Support

**Date:** 2026-03-28
**Status:** Draft
**Scope:** Enable AOS to run through Pi, Claude Code, Gemini, or Codex CLIs, allowing users to leverage existing subscriptions instead of API keys.

---

## 1. Problem

AOS currently has only one runtime adapter (Pi) that can execute agent sessions. The Claude Code and Gemini adapters are static code generators — they produce config files but cannot run agents. Users with Claude Max, Gemini, or Codex Pro subscriptions have no way to use those subscriptions with AOS. They must either use Pi with an API key or use the generators to produce artifacts for manual use.

## 2. Goal

Allow developers to run a full AOS deliberation session through any of four CLI backends:

| Backend | CLI Binary | Subscription |
|---|---|---|
| Pi | `pi` | Anthropic API key or subscription |
| Claude Code | `claude` | Claude Max |
| Gemini | `gemini` | Google Gemini subscription |
| Codex | `codex` | Codex Pro (OpenAI) |

Pi remains the recommended backend. All four are first-class alternatives.

## 3. Architecture

### 3.1 Generic CLI Agent Runtime

A single `CLIAgentRuntime` class implements `AgentRuntimeAdapter`. It handles the common subprocess lifecycle shared across all CLI backends:

- Subprocess spawn, stdout/stderr piping, exit code handling
- Line-by-line stream parsing via provider plugin
- Retry with exponential/linear backoff
- Timeout enforcement via AbortController
- Abort handling (SIGTERM → 5s → SIGKILL)
- Session file management (`.aos/sessions/<id>/<agent>.jsonl`)
- Token tracking (always), cost tracking (only when metered)

The runtime delegates all CLI-specific behavior to a `CLIProvider` plugin.

### 3.2 Provider Plugin Interface

Each backend implements this interface:

```typescript
interface CLIProviderCapabilities {
  session: "native" | "stateless";
  streaming: boolean;
  thinking: boolean;
  toolUse: boolean;
  contextFiles: boolean;
  systemPrompt: boolean;
  jsonOutput: boolean;
}

interface CLIProvider {
  id: "pi" | "claude-code" | "gemini" | "codex";
  binary: string;
  capabilities: CLIProviderCapabilities;

  buildArgs(opts: {
    message: string;
    systemPrompt?: string;
    sessionFile: string;
    model: string;
    thinking: ThinkingMode;
    contextFiles: string[];
    isFirstCall: boolean;
  }): string[];

  buildEnv(): Record<string, string>;

  parseLine(line: string): CLIEvent | null;

  resolveModelId(tier: ModelTier): string;

  detectAuthMode(): AuthMode;

  getModelCost(tier: ModelTier): ModelCost;
}
```

### 3.3 Normalized CLI Events

Provider plugins translate CLI-specific output into a common event type:

```typescript
type CLIEvent =
  | { type: "text_delta"; text: string }
  | { type: "message_end"; text: string; usage?: { input: number; output: number; cost?: number; contextTokens?: number }; model?: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "error"; message: string };
```

## 4. Backend Discovery & Selection

### 4.1 BackendResolver

On startup, AOS runs a `BackendResolver` that:

1. Detects which CLIs are installed by checking if the binary exists on PATH
2. Probes that the CLI is functional (e.g., `<binary> --version`)
3. Selects a backend using the fallback chain: `pi` → `claude` → `gemini` → `codex`
4. Allows override via `--backend <name>` CLI flag or `AOS_BACKEND` env var

If no CLI is found, AOS exits with a clear error listing what to install.

### 4.2 BackendInfo

```typescript
interface BackendInfo {
  id: "pi" | "claude-code" | "gemini" | "codex";
  binary: string;
  available: boolean;
  version?: string;
}
```

### 4.3 Override Behavior

- `--backend <name>` or `AOS_BACKEND=<name>` → validate that CLI exists, error if not
- No override → run fallback chain, pick first available
- If override specifies an unavailable CLI → error with install instructions, do not fall back

## 5. Provider Plugins

### 5.1 Pi Provider

- **Binary:** `pi`
- **Session:** Native (`--session <file>`)
- **Args:** `--mode json -p --no-extensions --no-skills --no-prompt-templates --no-themes --session <file> --thinking <mode> --model <model> <message>`
- **Parsing:** JSON event stream — `message_update` with `assistantMessageEvent.text_delta`, `message_end` with `usage` block
- **Auth:** `ANTHROPIC_API_KEY` present → `{ type: "api_key", metered: true }`, absent → `{ type: "subscription", metered: false }`
- **Env allowlist:** `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `AOS_MODEL_*`, `PATH`, `HOME`, `USER`, `SHELL`, `TERM`, `LANG`
- **Model map:**
  - `economy` → `anthropic/claude-haiku-4-5`
  - `standard` → `anthropic/claude-sonnet-4-6`
  - `premium` → `anthropic/claude-opus-4-6`
- **Capabilities:** All supported (session, streaming, thinking, toolUse, contextFiles, systemPrompt, jsonOutput)

### 5.2 Claude Code Provider

- **Binary:** `claude`
- **Session:** Explore native support via `--resume`/`--continue` flags. Fall back to `stateless` if unreliable.
- **Args:** `--output-format json --model <model> --system-prompt <prompt> -p <message>`
- **Parsing:** JSON output with `result` and `usage` fields. Token counts available, cost not reported in subscription mode.
- **Auth:** Always `{ type: "subscription", metered: false }`. Users with API keys should use Pi.
- **Env allowlist:** Standard system vars only. Claude Code manages auth via `~/.claude/`.
- **Model map:**
  - `economy` → `haiku`
  - `standard` → `sonnet`
  - `premium` → `opus`
- **Capabilities:** Streaming (yes), thinking (yes), toolUse (yes), contextFiles (yes), systemPrompt (yes), jsonOutput (yes). Session support TBD during implementation.

### 5.3 Gemini Provider

- **Binary:** `gemini`
- **Session:** TBD during implementation — explore Gemini CLI's session capabilities.
- **Args:** `--model <model> --output-format json <message>` (exact flags to be validated against Gemini CLI docs during implementation)
- **Parsing:** JSON output. Format to be confirmed during implementation.
- **Auth:** `GOOGLE_API_KEY` present → `{ type: "api_key", metered: true }`, absent → `{ type: "subscription", metered: false }`
- **Env allowlist:** Standard system vars, `GOOGLE_API_KEY`
- **Model map:**
  - `economy` → `gemini-2.0-flash`
  - `standard` → `gemini-2.5-pro`
  - `premium` → `gemini-2.5-pro`
- **Capabilities:** TBD during implementation. The plugin boundary isolates unknowns.

### 5.4 Codex Provider

- **Binary:** `codex`
- **Session:** TBD during implementation — explore Codex CLI's session capabilities.
- **Args:** `--model <model> --output-format json <message>` (exact flags to be validated against Codex CLI docs during implementation)
- **Parsing:** JSON output. Format to be confirmed during implementation.
- **Auth:** `OPENAI_API_KEY` present → `{ type: "api_key", metered: true }`, absent → `{ type: "subscription", metered: false }`
- **Env allowlist:** Standard system vars, `OPENAI_API_KEY`
- **Model map:**
  - `economy` → `o4-mini`
  - `standard` → `o3`
  - `premium` → `o3`
- **Capabilities:** TBD during implementation. The plugin boundary isolates unknowns.

For Gemini and Codex, CLI flags, output formats, and capability declarations are intentionally marked TBD. The plugin interface is the isolation boundary — these unknowns affect only the provider file, not the shared runtime or engine.

## 6. Native CLI Features

### 6.1 Principle

AOS leverages each CLI's native capabilities. No synthetic workarounds that block features.

### 6.2 Capability-Based Behavior

| Capability | Supported | Not Supported |
|---|---|---|
| Session | Use CLI's native mechanism (`--session`, `--resume`, `--continue`) | Pass full context each call using CLI's own flags |
| Streaming | Wire `onStream` callback to live output | Wait for full response, deliver at once |
| Thinking | Pass `--thinking` or equivalent flag | Omit flag, agent runs without extended thinking |
| Tool use | Allow CLI to use its native tools | Agent operates text-only |
| Context files | Inject via `@file` or equivalent syntax | Inline file contents into the message |
| System prompt | Pass via `--system-prompt` or equivalent | Prepend to first message |
| JSON output | Parse structured events | Parse plain text as single response |

### 6.3 No Synthetic Sessions

The runtime does not build its own conversation history management. If a CLI has no session support, that is a known limitation of that backend — documented, not papered over. Users who need multi-turn session fidelity should use Pi.

## 7. Auth Mode & Cost Tracking

### 7.1 Auth Detection

Each provider determines auth mode from its own environment:

- **Pi:** `ANTHROPIC_API_KEY` → metered, else subscription
- **Claude Code:** Always subscription (manages own auth)
- **Gemini:** `GOOGLE_API_KEY` → metered, else subscription
- **Codex:** `OPENAI_API_KEY` → metered, else subscription

### 7.2 Token & Cost Tracking

- **Token counts:** Always tracked when the CLI reports them. Used for context window management and compaction decisions regardless of billing mode.
- **Cost tracking:** Only when `authMode.metered === true`. Subscription backends report `cost: 0`.
- **Budget constraints:** Enabled only when metered. Subscription sessions skip budget enforcement (existing behavior via `ConstraintEngine`).

### 7.3 Model Tier Mapping

Each backend defines its own default tier-to-model mapping. Users override with `AOS_MODEL_ECONOMY`, `AOS_MODEL_STANDARD`, `AOS_MODEL_PREMIUM` env vars (existing mechanism, unchanged).

## 8. Integration with Existing Framework

### 8.1 Engine

`AOSEngine` takes an `AOSAdapter` in its constructor. No change needed — `CLIAgentRuntime` implements `AgentRuntimeAdapter`, which is part of `AOSAdapter`. The engine is backend-agnostic.

### 8.2 Entry Point

The AOS CLI entry point gains:

1. `--backend <pi|claude-code|gemini|codex>` flag and `AOS_BACKEND` env var
2. Backend resolution runs before engine construction
3. Selected provider is instantiated and passed to `CLIAgentRuntime`
4. Runtime is wired into `AOSAdapter` alongside existing L2/L3/L4 adapters

### 8.3 Capability Mismatch at Startup

After backend selection, the engine compares profile requirements against `provider.capabilities`:

- **Hard requirement mismatch** (e.g., profile mandates `thinking: "extended"`, backend doesn't support it) → Error, refuse to start, suggest Pi
- **Soft preference mismatch** (e.g., streaming unavailable) → Warning, continue with degraded experience

### 8.4 Existing Code Impact

- **`adapters/pi/src/agent-runtime.ts`** — Refactored. `PiAgentRuntime` replaced by `CLIAgentRuntime` + `PiProvider`. All current behavior preserved.
- **`adapters/pi/src/event-bus.ts`** — Unchanged (L2)
- **`adapters/pi/src/ui.ts`** — Unchanged (L3)
- **`adapters/pi/src/workflow.ts`** — Unchanged (L4)
- **`adapters/claude-code/src/generate.ts`** — Unchanged (generator)
- **`adapters/gemini/src/generate.ts`** — Unchanged (generator)
- **`runtime/src/types.ts`** — No changes to existing types. New types added in `adapters/shared/types.ts`.
- **`runtime/src/engine.ts`** — No changes
- **`runtime/src/constraint-engine.ts`** — No changes

## 9. File Structure

```
adapters/
  shared/
    cli-agent-runtime.ts      # Generic CLIAgentRuntime (AgentRuntimeAdapter)
    types.ts                  # CLIProvider, CLIEvent, CLIProviderCapabilities, BackendInfo
    backend-resolver.ts       # Detection, probing, fallback chain, override handling
  pi/src/
    provider.ts               # PiProvider plugin (extracted from agent-runtime.ts)
    agent-runtime.ts          # DELETED — logic moved to shared/cli-agent-runtime.ts + provider.ts
    event-bus.ts              # Unchanged (L2)
    ui.ts                     # Unchanged (L3)
    workflow.ts               # Unchanged (L4)
    index.ts                  # Updated — imports from shared + provider
  claude-code/src/
    provider.ts               # ClaudeCodeProvider plugin (NEW)
    generate.ts               # Unchanged (generator)
    templates.ts              # Unchanged (generator)
  gemini/src/
    provider.ts               # GeminiProvider plugin (NEW)
    generate.ts               # Unchanged (generator)
    templates.ts              # Unchanged (generator)
  codex/src/
    provider.ts               # CodexProvider plugin (NEW)
```

## 10. Error Handling

### 10.1 CLI Not Found at Runtime

Binary disappears mid-session → `sendMessage` fails with: `"Backend '<name>' not found. Is it installed and on PATH?"`. Standard retry logic applies. No automatic fallback to another backend mid-session.

### 10.2 Authentication Failures

CLI returns auth error → provider maps to `CLIEvent { type: "error" }` → runtime surfaces: `"Authentication failed for <name>. Run '<name> login' or switch to another backend with --backend"`. No retry on auth errors.

### 10.3 CLI Output Format Changes

Only the affected provider's `parseLine` breaks. Plugin boundary contains blast radius to one file.

### 10.4 Error Philosophy

- **Fail clearly** — never silently drop features
- **Fail early** — catch mismatches at startup, not mid-deliberation
- **Fail narrowly** — plugin boundary contains CLI-specific issues

## 11. Future Considerations

### 11.1 Mixed-Provider Sessions

Current design: single backend per session. The `CLIProvider` interface and `CLIAgentRuntime` are structured so that a future `MixedBackendRuntime` could hold multiple providers and route per-agent based on tier or routing rules. No breaking changes needed.

### 11.2 Additional Backends

New CLIs (Cursor, Windsurf, etc.) require only a new provider plugin file implementing `CLIProvider`. No changes to the shared runtime, engine, or existing providers.

### 11.3 API Key Mode for Non-Pi Backends

Currently, Claude Code/Gemini/Codex providers default to subscription mode. If these CLIs gain better API-key-mode support or cost reporting, the providers can update `detectAuthMode()` and `getModelCost()` independently.

## 12. Testing Strategy

- **Unit tests per provider:** Mock subprocess output, verify `parseLine` produces correct `CLIEvent` sequences
- **Unit tests for CLIAgentRuntime:** Mock provider, verify spawn/stream/retry/abort/timeout lifecycle
- **Unit tests for BackendResolver:** Mock `which` calls, verify fallback chain and override behavior
- **Integration tests:** Run each backend against a real CLI (where available in CI) with a minimal agent config
- **Capability mismatch tests:** Verify correct error/warning behavior when profile requirements exceed backend capabilities
