import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { EventBusAdapter } from "../../../runtime/src/types";

export class PiEventBus implements EventBusAdapter {
  private handlers: {
    sessionStart: (() => Promise<void>) | null;
    sessionShutdown: (() => Promise<void>) | null;
    beforeAgentStart: ((prompt: string) => Promise<{ systemPrompt?: string }>) | null;
    agentEnd: (() => Promise<void>) | null;
    toolCall: ((toolName: string, input: unknown) => Promise<{ block?: boolean }>) | null;
    toolResult: ((toolName: string, input: unknown, result: unknown) => Promise<void>) | null;
    messageEnd: ((usage: { cost: number; tokens: number }) => Promise<void>) | null;
    compaction: (() => Promise<void>) | null;
  } = {
    sessionStart: null,
    sessionShutdown: null,
    beforeAgentStart: null,
    agentEnd: null,
    toolCall: null,
    toolResult: null,
    messageEnd: null,
    compaction: null,
  };

  // ── EventBusAdapter — store handlers ────────────────────────────

  onSessionStart(handler: () => Promise<void>): void {
    this.handlers.sessionStart = handler;
  }

  onSessionShutdown(handler: () => Promise<void>): void {
    this.handlers.sessionShutdown = handler;
  }

  onBeforeAgentStart(handler: (prompt: string) => Promise<{ systemPrompt?: string }>): void {
    this.handlers.beforeAgentStart = handler;
  }

  onAgentEnd(handler: () => Promise<void>): void {
    this.handlers.agentEnd = handler;
  }

  onToolCall(handler: (toolName: string, input: unknown) => Promise<{ block?: boolean }>): void {
    this.handlers.toolCall = handler;
  }

  onToolResult(handler: (toolName: string, input: unknown, result: unknown) => Promise<void>): void {
    this.handlers.toolResult = handler;
  }

  onMessageEnd(handler: (usage: { cost: number; tokens: number }) => Promise<void>): void {
    this.handlers.messageEnd = handler;
  }

  onCompaction(handler: () => Promise<void>): void {
    this.handlers.compaction = handler;
  }

  // ── Wire to Pi's event system ────────────────────────────────────

  wire(pi: ExtensionAPI): void {
    pi.on("session_start", async (_event, _ctx) => {
      if (this.handlers.sessionStart) {
        await this.handlers.sessionStart();
      }
    });

    pi.on("session_shutdown", async (_event, _ctx) => {
      if (this.handlers.sessionShutdown) {
        await this.handlers.sessionShutdown();
      }
    });

    pi.on("before_agent_start", async (event, _ctx) => {
      if (this.handlers.beforeAgentStart) {
        const result = await this.handlers.beforeAgentStart(event.prompt);
        if (result.systemPrompt !== undefined) {
          return { systemPrompt: result.systemPrompt };
        }
      }
      return undefined;
    });

    pi.on("agent_end", async (_event, _ctx) => {
      if (this.handlers.agentEnd) {
        await this.handlers.agentEnd();
      }
    });

    pi.on("tool_call", async (event, _ctx) => {
      if (this.handlers.toolCall) {
        const result = await this.handlers.toolCall(event.toolName, event.input);
        if (result.block) {
          return { block: true };
        }
      }
      return undefined;
    });

    pi.on("tool_result", async (event, _ctx) => {
      if (this.handlers.toolResult) {
        await this.handlers.toolResult(event.toolName, event.input, event.content);
      }
    });

    pi.on("message_end", async (event, _ctx) => {
      if (this.handlers.messageEnd) {
        const msg = event.message as {
          usage?: { cost?: { total?: number }; totalTokens?: number };
        };
        const cost = msg.usage?.cost?.total ?? 0;
        const tokens = msg.usage?.totalTokens ?? 0;
        await this.handlers.messageEnd({ cost, tokens });
      }
    });

    pi.on("session_before_compact", async (_event, _ctx) => {
      if (this.handlers.compaction) {
        await this.handlers.compaction();
      }
      return undefined;
    });
  }
}
