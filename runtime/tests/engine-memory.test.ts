import { describe, it, expect, beforeEach } from "bun:test";
import { ExpertiseProvider } from "../src/expertise-provider";
import type { MemoryProvider, MemoryConfig } from "../src/memory-provider";

const CONFIG: MemoryConfig = {
  provider: "expertise",
  expertise: { maxLines: 200, scope: "per-project" },
  orchestrator: {
    rememberPrompt: "session_end",
    recallGate: true,
    maxRecallPerSession: 10,
  },
};

describe("Engine memory lifecycle", () => {
  let provider: MemoryProvider;

  beforeEach(async () => {
    provider = new ExpertiseProvider();
    await provider.initialize(CONFIG);
  });

  it("wake returns context that can be injected into prompts", async () => {
    await provider.remember("Auth uses Clerk for SSO", {
      projectId: "proj",
      agentId: "architect",
      hall: "hall_facts",
    });

    const ctx = await provider.wake("proj");
    expect(typeof ctx.essentials).toBe("string");
    expect(ctx.tokenEstimate).toBeGreaterThan(0);
  });

  it("recall respects maxRecallPerSession cap", async () => {
    await provider.remember("Decision A", { projectId: "proj", agentId: "a" });
    await provider.remember("Decision B", { projectId: "proj", agentId: "b" });

    let recallCount = 0;
    const maxRecall = CONFIG.orchestrator.maxRecallPerSession;

    for (let i = 0; i < 15; i++) {
      if (recallCount >= maxRecall) break;
      await provider.recall("decisions", { projectId: "proj" });
      recallCount++;
    }

    expect(recallCount).toBe(maxRecall);
  });

  it("remember at session end stores content retrievable in next wake", async () => {
    await provider.remember("We chose GraphQL over REST", {
      projectId: "proj",
      agentId: "architect",
      hall: "hall_facts",
      sessionId: "session-1",
    });
    await provider.remember("Performance target: p95 < 200ms", {
      projectId: "proj",
      agentId: "sentinel",
      hall: "hall_facts",
      sessionId: "session-1",
    });

    const ctx = await provider.wake("proj");
    expect(ctx.essentials).toContain("GraphQL");
    expect(ctx.essentials).toContain("200ms");
  });

  it("health check before session-end remember", async () => {
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
    if (health.healthy) {
      const id = await provider.remember("Safe to store", {
        projectId: "proj",
        agentId: "strategist",
      });
      expect(id).toBeTruthy();
    }
  });
});
