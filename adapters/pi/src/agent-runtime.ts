// ── Pi Agent Runtime (L1) ────────────────────────────────────────
// Subprocess management for Pi agents with persistent sessions,
// JSON event stream parsing, and token usage tracking.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type {
  AgentRuntimeAdapter,
  AgentHandle,
  AgentResponse,
  AgentConfig,
  MessageOpts,
  AuthMode,
  ModelCost,
  ModelTier,
  ThinkingMode,
  ContextUsage,
} from "@aos-framework/runtime/types";

// ── Per-handle state ─────────────────────────────────────────────

interface HandleState {
  config: AgentConfig;
  sessionFile: string;
  contextFiles: string[];
  modelConfig: { tier: ModelTier; thinking: ThinkingMode };
  lastContextTokens: number;
}

// ── Model tier resolution ────────────────────────────────────────

export function resolveModelId(tier: ModelTier): string {
  const map: Record<ModelTier, string> = {
    economy: process.env.AOS_MODEL_ECONOMY || "anthropic/claude-haiku-4-5",
    standard: process.env.AOS_MODEL_STANDARD || "anthropic/claude-sonnet-4-6",
    premium: process.env.AOS_MODEL_PREMIUM || "anthropic/claude-opus-4-6",
  };
  return map[tier];
}

// ── PiAgentRuntime ───────────────────────────────────────────────

export class PiAgentRuntime implements AgentRuntimeAdapter {
  private handles = new Map<string, HandleState>();
  private activeProcesses = new Set<ChildProcess>();
  private orchestratorPrompt: string | undefined;

  async spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle> {
    const sessionDir = join(".aos", "sessions", sessionId);
    mkdirSync(sessionDir, { recursive: true });

    const sessionFile = join(sessionDir, `${config.id}.jsonl`);

    const handle: AgentHandle = {
      id: `${sessionId}:${config.id}`,
      agentId: config.id,
      sessionId,
    };

    this.handles.set(handle.id, {
      config,
      sessionFile,
      contextFiles: [],
      modelConfig: { tier: config.model.tier, thinking: config.model.thinking },
      lastContextTokens: 0,
    });

    return handle;
  }

  async sendMessage(
    handle: AgentHandle,
    message: string,
    opts?: MessageOpts,
  ): Promise<AgentResponse> {
    const state = this.handles.get(handle.id);
    if (!state) {
      return {
        text: "",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        contextTokens: 0,
        model: "unknown",
        status: "failed",
        error: `No state found for handle ${handle.id}`,
      };
    }

    const args: string[] = [
      "--mode",
      "json",
      "-p",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--session",
      state.sessionFile,
      "--thinking",
      state.modelConfig.thinking,
    ];

    // First call: session file doesn't exist — set system prompt, model, and context files
    const isFirstCall = !existsSync(state.sessionFile);
    if (isFirstCall) {
      const systemPrompt = state.config.systemPrompt || "";
      if (systemPrompt) {
        args.push("--system-prompt", systemPrompt);
      }
      args.push("--model", resolveModelId(state.modelConfig.tier));

      // Inject context files via @file syntax
      const contextFiles = opts?.contextFiles?.length
        ? opts.contextFiles
        : state.contextFiles;
      for (const file of contextFiles) {
        args.push(`@${file}`);
      }
    }

    // Final arg: the message
    args.push(message);

    return new Promise<AgentResponse>((resolve) => {
      const proc = spawn("pi", args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.activeProcesses.add(proc);

      let buffer = "";
      let stderr = "";
      let accumulatedText = "";
      let finalResponse = "";
      let tokensIn = 0;
      let tokensOut = 0;
      let cost = 0;
      let contextTokens = 0;
      let model = resolveModelId(state.modelConfig.tier);
      let wasAborted = false;

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }

        // Track tool usage
        if (event.type === "tool_execution_start") {
          // Optional tracking — no action needed
        }

        // Stream text deltas
        if (event.type === "message_update" && event.assistantMessageEvent) {
          const ame = event.assistantMessageEvent;
          if (ame.type === "text_delta" && (ame.delta || ame.text)) {
            accumulatedText += ame.delta || ame.text;
            opts?.onStream?.(accumulatedText);
          }
        }

        // Final message with usage stats
        if (event.type === "message_end" && event.message) {
          const msg = event.message;
          if (msg.role === "assistant") {
            // Extract full response text from content blocks
            if (msg.content && Array.isArray(msg.content)) {
              for (const part of msg.content) {
                if (part.type === "text") {
                  finalResponse = part.text;
                }
              }
            }

            // Extract usage stats
            const usage = msg.usage;
            if (usage) {
              tokensIn += usage.input || 0;
              tokensOut += usage.output || 0;
              cost += usage.cost?.total || 0;
              contextTokens = usage.totalTokens || 0;
            }
            if (msg.model) model = msg.model;
          }
        }
      };

      proc.stdout!.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr!.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        // Process any remaining buffered data
        if (buffer.trim()) processLine(buffer);

        this.activeProcesses.delete(proc);

        // Update last known context tokens
        if (contextTokens > 0) {
          state.lastContextTokens = contextTokens;
        }

        if (wasAborted) {
          resolve({
            text: accumulatedText,
            tokensIn,
            tokensOut,
            cost,
            contextTokens,
            model,
            status: "aborted",
            error: "Agent call was aborted",
          });
          return;
        }

        if (code !== 0 && !finalResponse && !accumulatedText) {
          resolve({
            text: "",
            tokensIn,
            tokensOut,
            cost,
            contextTokens,
            model,
            status: "failed",
            error: `Process exited with code ${code}: ${stderr.slice(0, 500)}`,
          });
          return;
        }

        resolve({
          text: finalResponse || accumulatedText,
          tokensIn,
          tokensOut,
          cost,
          contextTokens,
          model,
          status: "success",
        });
      });

      proc.on("error", (err: Error) => {
        this.activeProcesses.delete(proc);
        resolve({
          text: "",
          tokensIn: 0,
          tokensOut: 0,
          cost: 0,
          contextTokens: 0,
          model,
          status: "failed",
          error: `Failed to spawn pi: ${err.message}`,
        });
      });

      // Handle abort signal
      if (opts?.signal) {
        const killProc = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, 5000);
        };
        if (opts.signal.aborted) {
          killProc();
        } else {
          opts.signal.addEventListener("abort", killProc, { once: true });
        }
      }
    });
  }

  async destroyAgent(_handle: AgentHandle): Promise<void> {
    // No-op — sessions persist on disk
  }

  setOrchestratorPrompt(prompt: string): void {
    this.orchestratorPrompt = prompt;
  }

  async injectContext(handle: AgentHandle, files: string[]): Promise<void> {
    const state = this.handles.get(handle.id);
    if (state) {
      state.contextFiles = files;
    }
  }

  getContextUsage(handle: AgentHandle): ContextUsage {
    const state = this.handles.get(handle.id);
    const tokens = state?.lastContextTokens || 0;
    // Estimate percent based on 200k context window
    const maxContext = 200_000;
    return {
      tokens,
      percent: maxContext > 0 ? (tokens / maxContext) * 100 : 0,
    };
  }

  setModel(handle: AgentHandle, modelConfig: { tier: ModelTier; thinking: ThinkingMode }): void {
    const state = this.handles.get(handle.id);
    if (state) {
      state.modelConfig = modelConfig;
    }
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

  abort(): void {
    for (const proc of this.activeProcesses) {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5000);
    }
    this.activeProcesses.clear();
  }
}
