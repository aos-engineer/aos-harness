import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CodexAgentRuntime } from "../src/agent-runtime";
import { BaseEventBus } from "@aos-harness/adapter-shared";

// Minimal stub for BaseEventBus
class StubEventBus extends BaseEventBus {}

describe("CodexAgentRuntime", () => {
  it("cliBinary returns 'codex'", () => {
    const rt = new CodexAgentRuntime(new StubEventBus());
    expect(rt.cliBinary()).toBe("codex");
  });

  it("stdoutFormat returns 'ndjson'", () => {
    const rt = new CodexAgentRuntime(new StubEventBus());
    expect(rt.stdoutFormat()).toBe("ndjson");
  });

  describe("buildArgs", () => {
    const state = {
      config: {
        id: "test-agent",
        systemPrompt: "You are a helpful assistant.",
        model: { tier: "standard" as const, thinking: "on" as const },
        tools: [],
        skills: [],
      },
      sessionFile: "/tmp/test-session.jsonl",
      contextFiles: ["/tmp/context.md"],
      modelConfig: { tier: "standard" as const, thinking: "on" as const },
      lastContextTokens: 0,
    };

    it("first call includes --full-auto, --model, --system-prompt, and message", () => {
      const rt = new CodexAgentRuntime(new StubEventBus());
      const args = rt.buildArgs(state, "Hello world", true);

      expect(args).toContain("--full-auto");
      expect(args).toContain("--model");
      expect(args).toContain("--system-prompt");
      expect(args).toContain("You are a helpful assistant.");
      // Message should be the last argument
      expect(args[args.length - 1]).toBe("Hello world");
    });

    it("first call includes --file for context files", () => {
      const rt = new CodexAgentRuntime(new StubEventBus());
      const args = rt.buildArgs(state, "Hello", true);

      expect(args).toContain("--file");
      expect(args).toContain("/tmp/context.md");
    });

    it("subsequent call includes --session and no --system-prompt", () => {
      const rt = new CodexAgentRuntime(new StubEventBus());
      const args = rt.buildArgs(state, "Follow-up message", false);

      expect(args).toContain("--full-auto");
      expect(args).toContain("--model");
      expect(args).toContain("--session");
      expect(args).toContain("/tmp/test-session.jsonl");
      expect(args).not.toContain("--system-prompt");
      expect(args[args.length - 1]).toBe("Follow-up message");
    });
  });

  describe("parseEventLine", () => {
    const rt = new CodexAgentRuntime(new StubEventBus());

    it("parses result type → message_end", () => {
      const line = JSON.stringify({
        type: "result",
        result: "Hello from Codex",
        usage: { input_tokens: 100, output_tokens: 50 },
        cost_usd: 0.002,
        model: "o3",
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("message_end");
      if (event!.type === "message_end") {
        expect(event.text).toBe("Hello from Codex");
        expect(event.tokensIn).toBe(100);
        expect(event.tokensOut).toBe(50);
        expect(event.cost).toBe(0.002);
        expect(event.model).toBe("o3");
      }
    });

    it("parses content_block_delta → text_delta", () => {
      const line = JSON.stringify({
        type: "content_block_delta",
        delta: { text: "streaming text" },
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("text_delta");
      if (event!.type === "text_delta") {
        expect(event.text).toBe("streaming text");
      }
    });

    it("parses OpenAI choices streaming delta → text_delta", () => {
      const line = JSON.stringify({
        choices: [{ delta: { content: "streamed chunk" } }],
        model: "o3",
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("text_delta");
      if (event!.type === "text_delta") {
        expect(event.text).toBe("streamed chunk");
      }
    });

    it("parses OpenAI choices message format → message_end", () => {
      const line = JSON.stringify({
        choices: [{ message: { content: "Full response text" } }],
        usage: { prompt_tokens: 80, completion_tokens: 40 },
        model: "o3",
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("message_end");
      if (event!.type === "message_end") {
        expect(event.text).toBe("Full response text");
        expect(event.tokensIn).toBe(80);
        expect(event.tokensOut).toBe(40);
        expect(event.model).toBe("o3");
      }
    });

    it("parses tool_call → tool_call", () => {
      const line = JSON.stringify({
        type: "tool_call",
        name: "bash",
        input: { command: "ls" },
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("tool_call");
      if (event!.type === "tool_call") {
        expect(event.name).toBe("bash");
        expect(event.input).toEqual({ command: "ls" });
      }
    });

    it("parses function_call → tool_call", () => {
      const line = JSON.stringify({
        type: "function_call",
        name: "search",
        args: { query: "openai" },
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("tool_call");
      if (event!.type === "tool_call") {
        expect(event.name).toBe("search");
      }
    });

    it("returns ignored for unknown event types", () => {
      const line = JSON.stringify({ type: "unknown_event", data: "foo" });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("ignored");
    });

    it("returns null for invalid JSON", () => {
      const event = rt.parseEventLine("not valid json");
      expect(event).toBeNull();
    });
  });

  it("defaultModelMap returns o4-mini/o3/o3", () => {
    const rt = new CodexAgentRuntime(new StubEventBus());
    const map = rt.defaultModelMap();
    expect(map.economy).toBe("o4-mini");
    expect(map.standard).toBe("o3");
    expect(map.premium).toBe("o3");
  });

  describe("getAuthMode", () => {
    let savedKey: string | undefined;

    beforeEach(() => {
      savedKey = process.env.OPENAI_API_KEY;
    });

    afterEach(() => {
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
    });

    it("returns api_key when OPENAI_API_KEY is set", () => {
      process.env.OPENAI_API_KEY = "sk-test-openai-key";
      const rt = new CodexAgentRuntime(new StubEventBus());
      const auth = rt.getAuthMode();
      expect(auth.type).toBe("api_key");
      expect(auth.metered).toBe(true);
    });

    it("returns unknown when OPENAI_API_KEY is not set", () => {
      delete process.env.OPENAI_API_KEY;
      const rt = new CodexAgentRuntime(new StubEventBus());
      const auth = rt.getAuthMode();
      expect(auth.type).toBe("unknown");
      expect(auth.metered).toBe(false);
    });
  });
});
