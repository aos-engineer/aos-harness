// ── CodexAgentRuntime (L1) ────────────────────────────────────────
// Extends BaseAgentRuntime with OpenAI Codex CLI integration.

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

// ── CodexAgentRuntime ─────────────────────────────────────────────

export class CodexAgentRuntime extends BaseAgentRuntime {
  constructor(eventBus: BaseEventBus, modelOverrides?: Partial<Record<ModelTier, string>>) {
    super(eventBus, modelOverrides);
  }

  cliBinary(): string {
    return "codex";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[] {
    const args: string[] = ["--full-auto", "--model", this.resolveModelId(state.modelConfig.tier)];

    if (isFirstCall) {
      // System prompt
      const systemPrompt = state.config.systemPrompt || "";
      if (systemPrompt) {
        args.push("--system-prompt", systemPrompt);
      }

      // Context files
      const contextFiles = opts?.contextFiles?.length
        ? opts.contextFiles
        : state.contextFiles;
      for (const file of contextFiles) {
        args.push("--file", file);
      }
    } else {
      // Resume session
      args.push("--session", state.sessionFile);
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

    // Codex result format with usage stats
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

    // Streaming text delta (Anthropic-style)
    if (event.type === "content_block_delta" && event.delta?.text !== undefined) {
      return { type: "text_delta", text: event.delta.text };
    }

    // OpenAI streaming choices format
    if (Array.isArray(event.choices)) {
      const choice = event.choices[0];

      // Streaming delta with content
      if (choice?.delta?.content !== undefined && choice.delta.content !== null) {
        return { type: "text_delta", text: choice.delta.content };
      }

      // Non-streaming message with full content and usage
      if (choice?.message?.content !== undefined) {
        const usage = event.usage ?? {};
        return {
          type: "message_end",
          text: choice.message.content ?? "",
          tokensIn: usage.prompt_tokens ?? 0,
          tokensOut: usage.completion_tokens ?? 0,
          cost: 0,
          contextTokens: (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
          model: event.model ?? "",
        };
      }
    }

    // Tool call / function call
    if (event.type === "tool_call" || event.type === "function_call") {
      return { type: "tool_call", name: event.name ?? "unknown", input: event.input ?? event.args ?? {} };
    }

    return { type: "ignored" };
  }

  buildSubprocessEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const allowlist = [
      "PATH", "HOME", "USER", "SHELL", "TERM", "LANG",
      "OPENAI_API_KEY",
      "AOS_MODEL_ECONOMY", "AOS_MODEL_STANDARD", "AOS_MODEL_PREMIUM",
    ];
    for (const key of allowlist) {
      if (process.env[key] !== undefined) env[key] = process.env[key]!;
    }
    return env;
  }

  async discoverModels(): Promise<ModelInfo[]> {
    try {
      const output = execSync("codex model list --json", {
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
          provider: "codex",
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
      provider: "codex",
    }));
  }

  defaultModelMap(): Record<ModelTier, string> {
    return {
      economy: "o4-mini",
      standard: "o3",
      premium: "o3",
    };
  }

  getAuthMode(): AuthMode {
    if (process.env.OPENAI_API_KEY) {
      return { type: "api_key", metered: true };
    }
    return { type: "unknown", metered: false };
  }

  getModelCost(tier: ModelTier): ModelCost {
    const pricing: Record<ModelTier, ModelCost> = {
      economy: {
        inputPerMillionTokens: 1.10,
        outputPerMillionTokens: 4.40,
        currency: "USD",
      },
      standard: {
        inputPerMillionTokens: 10.00,
        outputPerMillionTokens: 40.00,
        currency: "USD",
      },
      premium: {
        inputPerMillionTokens: 10.00,
        outputPerMillionTokens: 40.00,
        currency: "USD",
      },
    };
    return pricing[tier];
  }
}
