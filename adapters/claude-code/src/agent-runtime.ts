// ── ClaudeCodeAgentRuntime (L1) ───────────────────────────────────
// Extends BaseAgentRuntime with Claude Code CLI integration.

import { execSync } from "node:child_process";
import type {
  AuthMode,
  ModelCost,
  ModelTier,
  MessageOpts,
} from "@aos-harness/runtime/types";
import {
  BaseAgentRuntime,
  type HandleState,
  type ParsedEvent,
  type StdoutFormat,
  type ModelInfo,
} from "@aos-harness/adapter-shared";
import type { BaseEventBus } from "@aos-harness/adapter-shared";

// ── McpBridgeOptions ─────────────────────────────────────────────

export interface McpBridgeOptions {
  bridgeScriptPath: string;
  socketPath: string;
}

// ── ClaudeCodeAgentRuntime ────────────────────────────────────────

export class ClaudeCodeAgentRuntime extends BaseAgentRuntime {
  constructor(eventBus: BaseEventBus, modelOverrides?: Partial<Record<ModelTier, string>>) {
    super(eventBus, modelOverrides);
  }

  cliBinary(): string {
    return "claude";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[] {
    const args: string[] = ["--print", "--output-format", "json", "--verbose"];

    if (isFirstCall) {
      // System prompt
      const systemPrompt = state.config.systemPrompt || "";
      if (systemPrompt) {
        args.push("--system-prompt", systemPrompt);
      }

      // Model
      args.push("--model", this.resolveModelId(state.modelConfig.tier));

      // Context files
      const contextFiles = opts?.contextFiles?.length
        ? opts.contextFiles
        : state.contextFiles;
      for (const file of contextFiles) {
        args.push("--add-file", file);
      }
    } else {
      // Resume session
      args.push("--resume", state.sessionFile);
    }

    // Message is always the final argument
    args.push(message);
    return args;
  }

  parseEventLine(line: string): ParsedEvent | null {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return null;
    }

    // Final result with usage stats
    if (event.type === "result") {
      const usage = event.usage ?? {};
      return {
        type: "message_end",
        text: event.result ?? "",
        tokensIn: usage.input_tokens ?? 0,
        tokensOut: usage.output_tokens ?? 0,
        cost: event.cost_usd ?? 0,
        contextTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        model: event.model ?? "",
      };
    }

    // Streaming text delta
    if (event.type === "content_block_delta" && event.delta?.text !== undefined) {
      return { type: "text_delta", text: event.delta.text };
    }

    // Tool call
    if (event.type === "tool_use") {
      return { type: "tool_call", name: event.name ?? "unknown", input: event.input ?? {} };
    }

    // Tool result — content or output field
    if (event.type === "tool_result") {
      const result = event.content ?? event.output ?? null;
      return { type: "tool_result", name: event.name ?? "unknown", input: {}, result };
    }

    return { type: "ignored" };
  }

  buildSubprocessEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const allowlist = [
      "PATH", "HOME", "USER", "SHELL", "TERM", "LANG",
      "ANTHROPIC_API_KEY",
      "AOS_MODEL_ECONOMY", "AOS_MODEL_STANDARD", "AOS_MODEL_PREMIUM",
    ];
    for (const key of allowlist) {
      if (process.env[key] !== undefined) env[key] = process.env[key]!;
    }
    return env;
  }

  async discoverModels(): Promise<ModelInfo[]> {
    try {
      const output = execSync("claude model list --json", {
        encoding: "utf-8",
        timeout: 10_000,
        env: this.buildSubprocessEnv(),
      });
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) {
        return parsed.map((m: any) => ({
          id: m.id ?? m.name,
          name: m.name ?? m.id,
          contextWindow: m.context_window ?? m.contextWindow ?? 200_000,
          provider: "claude",
        }));
      }
    } catch {
      // Fall through to defaults
    }
    const defaults = this.defaultModelMap();
    return Object.entries(defaults).map(([_tier, id]) => ({
      id,
      name: id,
      contextWindow: 200_000,
      provider: "claude",
    }));
  }

  defaultModelMap(): Record<ModelTier, string> {
    return {
      economy: "claude-haiku-4-5",
      standard: "claude-sonnet-4-6",
      premium: "claude-opus-4-6",
    };
  }

  getAuthMode(): AuthMode {
    if (process.env.ANTHROPIC_API_KEY) {
      return { type: "api_key", metered: true };
    }
    return { type: "subscription", metered: false };
  }

  getModelCost(tier: ModelTier): ModelCost {
    const pricing: Record<ModelTier, ModelCost> = {
      economy: {
        inputPerMillionTokens: 0.80,
        outputPerMillionTokens: 4.00,
        currency: "USD",
      },
      standard: {
        inputPerMillionTokens: 3.00,
        outputPerMillionTokens: 15.00,
        currency: "USD",
      },
      premium: {
        inputPerMillionTokens: 15.00,
        outputPerMillionTokens: 75.00,
        currency: "USD",
      },
    };
    return pricing[tier];
  }

  buildMcpArgs(opts: McpBridgeOptions): string[] {
    const config = JSON.stringify({
      mcpServers: {
        aos: {
          command: "bun",
          args: [opts.bridgeScriptPath],
          env: { AOS_BRIDGE_SOCKET: opts.socketPath },
        },
      },
    });
    return [
      "--mcp-config", config,
      "--strict-mcp-config",
      "--allowedTools", "mcp__aos__delegate mcp__aos__end",
      "--permission-mode", "bypassPermissions",
    ];
  }
}
