import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ClaudeCodeAgentRuntime } from "../src/agent-runtime";
import { BaseEventBus } from "@aos-harness/adapter-shared";

// Minimal stub for BaseEventBus
class StubEventBus extends BaseEventBus {}

function makeRuntime(env: Record<string, string> = {}): ClaudeCodeAgentRuntime {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const runtime = new ClaudeCodeAgentRuntime(new StubEventBus());
  // restore after construction (actual calls may still read process.env at call time)
  for (const [k] of Object.entries(env)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  return runtime;
}

describe("ClaudeCodeAgentRuntime", () => {
  it("cliBinary returns 'claude'", () => {
    const rt = new ClaudeCodeAgentRuntime(new StubEventBus());
    expect(rt.cliBinary()).toBe("claude");
  });

  it("stdoutFormat returns 'ndjson'", () => {
    const rt = new ClaudeCodeAgentRuntime(new StubEventBus());
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

    it("first call includes --print, --output-format, --system-prompt, --model, and message", () => {
      const rt = new ClaudeCodeAgentRuntime(new StubEventBus());
      const args = rt.buildArgs(state, "Hello world", true);

      expect(args).toContain("--print");
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
      expect(args).toContain("--verbose");
      expect(args).toContain("--system-prompt");
      expect(args).toContain("You are a helpful assistant.");
      expect(args).toContain("--model");
      // Message should be the last argument
      expect(args[args.length - 1]).toBe("Hello world");
    });

    it("first call includes --add-file for context files", () => {
      const rt = new ClaudeCodeAgentRuntime(new StubEventBus());
      const args = rt.buildArgs(state, "Hello", true);

      expect(args).toContain("--add-file");
      expect(args).toContain("/tmp/context.md");
    });

    it("subsequent call includes --resume and no --system-prompt", () => {
      const rt = new ClaudeCodeAgentRuntime(new StubEventBus());
      const args = rt.buildArgs(state, "Follow-up message", false);

      expect(args).toContain("--print");
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
      expect(args).toContain("--verbose");
      expect(args).toContain("--resume");
      expect(args).toContain("/tmp/test-session.jsonl");
      expect(args).not.toContain("--system-prompt");
      expect(args[args.length - 1]).toBe("Follow-up message");
    });
  });

  describe("parseEventLine", () => {
    const rt = new ClaudeCodeAgentRuntime(new StubEventBus());

    it("parses result type → message_end", () => {
      const line = JSON.stringify({
        type: "result",
        result: "Hello from Claude",
        usage: { input_tokens: 100, output_tokens: 50 },
        cost_usd: 0.002,
        model: "claude-sonnet-4-6",
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("message_end");
      if (event!.type === "message_end") {
        expect(event.text).toBe("Hello from Claude");
        expect(event.tokensIn).toBe(100);
        expect(event.tokensOut).toBe(50);
        expect(event.cost).toBe(0.002);
        expect(event.model).toBe("claude-sonnet-4-6");
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

    it("parses tool_use → tool_call", () => {
      const line = JSON.stringify({
        type: "tool_use",
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

    it("parses tool_result → tool_result", () => {
      const line = JSON.stringify({
        type: "tool_result",
        name: "bash",
        content: "file1.txt\nfile2.txt",
      });
      const event = rt.parseEventLine(line);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("tool_result");
      if (event!.type === "tool_result") {
        expect(event.name).toBe("bash");
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

  it("defaultModelMap returns correct models", () => {
    const rt = new ClaudeCodeAgentRuntime(new StubEventBus());
    const map = rt.defaultModelMap();
    expect(map.economy).toBe("claude-haiku-4-5");
    expect(map.standard).toBe("claude-sonnet-4-6");
    expect(map.premium).toBe("claude-opus-4-6");
  });

  describe("getAuthMode", () => {
    let savedKey: string | undefined;

    beforeEach(() => {
      savedKey = process.env.ANTHROPIC_API_KEY;
    });

    afterEach(() => {
      if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = savedKey;
    });

    it("returns api_key when ANTHROPIC_API_KEY is set", () => {
      process.env.ANTHROPIC_API_KEY = "sk-test-key";
      const rt = new ClaudeCodeAgentRuntime(new StubEventBus());
      const auth = rt.getAuthMode();
      expect(auth.type).toBe("api_key");
      expect(auth.metered).toBe(true);
    });

    it("returns subscription when ANTHROPIC_API_KEY is not set", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const rt = new ClaudeCodeAgentRuntime(new StubEventBus());
      const auth = rt.getAuthMode();
      expect(auth.type).toBe("subscription");
      expect(auth.metered).toBe(false);
    });
  });
});
