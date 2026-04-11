// ── GeminiAgentRuntime Tests ────────────────────────────────────
import { describe, it, expect, beforeEach } from "bun:test";
import { GeminiAgentRuntime } from "../src/agent-runtime";
import type { BaseEventBus } from "@aos-harness/adapter-shared";
import type { HandleState } from "@aos-harness/adapter-shared";
import type { AgentConfig } from "@aos-harness/runtime/types";

// Minimal stub EventBus
const mockEventBus: BaseEventBus = {
  fireToolCall: () => {},
  fireToolResult: () => {},
  fireMessageEnd: () => {},
} as unknown as BaseEventBus;

function makeState(overrides: Partial<HandleState> = {}): HandleState {
  const config: AgentConfig = {
    id: "test-agent",
    name: "Test Agent",
    systemPrompt: "You are a test agent.",
    model: { tier: "standard", thinking: "on" },
    tools: [],
  } as unknown as AgentConfig;

  return {
    config,
    sessionFile: "/tmp/session.jsonl",
    contextFiles: [],
    modelConfig: { tier: "standard", thinking: "on" },
    lastContextTokens: 0,
    ...overrides,
  };
}

describe("GeminiAgentRuntime", () => {
  let runtime: GeminiAgentRuntime;

  beforeEach(() => {
    runtime = new GeminiAgentRuntime(mockEventBus);
  });

  // Test 1: cliBinary
  it("cliBinary returns 'gemini'", () => {
    expect(runtime.cliBinary()).toBe("gemini");
  });

  // Test 2: stdoutFormat
  it("stdoutFormat returns 'ndjson'", () => {
    expect(runtime.stdoutFormat()).toBe("ndjson");
  });

  // Test 3: buildArgs for first call
  it("buildArgs builds correct args for first call", () => {
    const state = makeState({
      contextFiles: ["/path/to/context.md"],
    });
    const args = runtime.buildArgs(state, "Hello world", true);

    expect(args[0]).toBe("--json");
    expect(args).toContain("--model");
    expect(args).toContain("--system-instruction");
    expect(args).toContain("You are a test agent.");
    expect(args).toContain("--file");
    expect(args).toContain("/path/to/context.md");
    expect(args[args.length - 1]).toBe("Hello world");
  });

  // Test 4: buildArgs for subsequent call
  it("buildArgs builds correct args for subsequent call", () => {
    const state = makeState();
    const args = runtime.buildArgs(state, "Follow up", false);

    expect(args[0]).toBe("--json");
    expect(args).toContain("--model");
    expect(args).toContain("--session");
    expect(args).toContain("/tmp/session.jsonl");
    expect(args).not.toContain("--system-instruction");
    expect(args).not.toContain("--file");
    expect(args[args.length - 1]).toBe("Follow up");
  });

  // Test 5: parseEventLine handles result → message_end
  it("parseEventLine handles result type → message_end", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Final answer",
      usage: { input_tokens: 100, output_tokens: 50 },
      cost_usd: 0.005,
      model: "gemini-2.5-pro",
    });
    const event = runtime.parseEventLine(line);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message_end");
    if (event!.type === "message_end") {
      expect(event.text).toBe("Final answer");
      expect(event.tokensIn).toBe(100);
      expect(event.tokensOut).toBe(50);
      expect(event.cost).toBe(0.005);
      expect(event.model).toBe("gemini-2.5-pro");
    }
  });

  // Test 6: parseEventLine handles candidates format → message_end
  it("parseEventLine handles candidates format → message_end", () => {
    const line = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: "Candidates answer" }],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 80,
        candidatesTokenCount: 40,
      },
    });
    const event = runtime.parseEventLine(line);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message_end");
    if (event!.type === "message_end") {
      expect(event.text).toBe("Candidates answer");
      expect(event.tokensIn).toBe(80);
      expect(event.tokensOut).toBe(40);
    }
  });

  // Test 7: defaultModelMap
  it("defaultModelMap returns correct models", () => {
    const map = runtime.defaultModelMap();
    expect(map.economy).toBe("gemini-2.0-flash");
    expect(map.standard).toBe("gemini-2.5-pro");
    expect(map.premium).toBe("gemini-2.5-pro");
  });

  // Test 8: getAuthMode with GOOGLE_API_KEY
  it("getAuthMode returns api_key/metered when GOOGLE_API_KEY is set", () => {
    const original = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = "test-key-123";
    try {
      const auth = runtime.getAuthMode();
      expect(auth.type).toBe("api_key");
      expect(auth.metered).toBe(true);
    } finally {
      if (original === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = original;
    }
  });
});
