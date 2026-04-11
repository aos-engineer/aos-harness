// ── GeminiAgentRuntime (L1) ────────────────────────────────────────
// Extends BaseAgentRuntime with Gemini CLI integration.

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

// ── GeminiAgentRuntime ────────────────────────────────────────────

export class GeminiAgentRuntime extends BaseAgentRuntime {
  constructor(eventBus: BaseEventBus, modelOverrides?: Partial<Record<ModelTier, string>>) {
    super(eventBus, modelOverrides);
  }

  cliBinary(): string {
    return "gemini";
  }

  stdoutFormat(): StdoutFormat {
    return "ndjson";
  }

  buildArgs(state: HandleState, message: string, isFirstCall: boolean, opts?: MessageOpts): string[] {
    const args: string[] = ["--json", "--model", this.resolveModelId(state.modelConfig.tier)];

    if (isFirstCall) {
      // System prompt
      const systemPrompt = state.config.systemPrompt || "";
      if (systemPrompt) {
        args.push("--system-instruction", systemPrompt);
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

    // Gemini CLI result format with usage stats
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

    // Gemini REST-style candidates format
    if (Array.isArray(event.candidates)) {
      const candidate = event.candidates[0];
      const parts = candidate?.content?.parts ?? [];
      const text = parts
        .filter((p: any) => typeof p.text === "string")
        .map((p: any) => p.text)
        .join("");
      const meta = event.usageMetadata ?? {};
      return {
        type: "message_end",
        text,
        tokensIn: meta.promptTokenCount ?? 0,
        tokensOut: meta.candidatesTokenCount ?? 0,
        cost: 0,
        contextTokens: (meta.promptTokenCount ?? 0) + (meta.candidatesTokenCount ?? 0),
        model: event.modelVersion ?? "",
      };
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
      "GOOGLE_API_KEY", "GEMINI_API_KEY",
      "AOS_MODEL_ECONOMY", "AOS_MODEL_STANDARD", "AOS_MODEL_PREMIUM",
    ];
    for (const key of allowlist) {
      if (process.env[key] !== undefined) env[key] = process.env[key]!;
    }
    return env;
  }

  async discoverModels(): Promise<ModelInfo[]> {
    try {
      const output = execSync("gemini model list --json", {
        encoding: "utf-8",
        timeout: 10_000,
        env: this.buildSubprocessEnv(),
      });
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) {
        return parsed.map((m: any) => ({
          id: m.id ?? m.name,
          name: m.name ?? m.id,
          contextWindow: m.context_window ?? m.contextWindow ?? 1_000_000,
          provider: "gemini",
        }));
      }
    } catch {
      // Fall through to defaults
    }
    const defaults = this.defaultModelMap();
    return Object.entries(defaults).map(([_tier, id]) => ({
      id,
      name: id,
      contextWindow: 1_000_000,
      provider: "gemini",
    }));
  }

  defaultModelMap(): Record<ModelTier, string> {
    return {
      economy: "gemini-2.0-flash",
      standard: "gemini-2.5-pro",
      premium: "gemini-2.5-pro",
    };
  }

  getAuthMode(): AuthMode {
    if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
      return { type: "api_key", metered: true };
    }
    return { type: "unknown", metered: false };
  }

  getModelCost(tier: ModelTier): ModelCost {
    const pricing: Record<ModelTier, ModelCost> = {
      economy: {
        inputPerMillionTokens: 0.10,
        outputPerMillionTokens: 0.40,
        currency: "USD",
      },
      standard: {
        inputPerMillionTokens: 1.25,
        outputPerMillionTokens: 10.00,
        currency: "USD",
      },
      premium: {
        inputPerMillionTokens: 1.25,
        outputPerMillionTokens: 10.00,
        currency: "USD",
      },
    };
    return pricing[tier];
  }
}
