import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { loadAgent, loadProfile, loadDomain, validateBrief } from "../src/config-loader";

const fixturesDir = join(import.meta.dir, "..", "fixtures");

describe("loadAgent", () => {
  it("loads a valid agent from yaml + prompt.md", () => {
    const agent = loadAgent(join(fixturesDir, "agents", "catalyst"));
    expect(agent.id).toBe("catalyst");
    expect(agent.name).toBe("Catalyst");
    expect(agent.cognition.core_bias).toBe("speed-and-monetization");
    expect(agent.persona.heuristics).toHaveLength(2);
    expect(agent.systemPrompt).toContain("{{session_id}}");
  });

  it("throws on missing agent.yaml", () => {
    expect(() => loadAgent("/nonexistent/path")).toThrow();
  });

  it("validates schema field", () => {
    const agent = loadAgent(join(fixturesDir, "agents", "catalyst"));
    expect(agent.schema).toBe("aos/agent/v1");
  });
});

describe("loadProfile", () => {
  it("loads a valid profile", () => {
    const profile = loadProfile(join(fixturesDir, "profiles", "test-council"));
    expect(profile.id).toBe("test-council");
    expect(profile.constraints.time.max_minutes).toBe(5);
    expect(profile.assembly.perspectives).toHaveLength(1);
  });

  it("throws on missing profile.yaml", () => {
    expect(() => loadProfile("/nonexistent/path")).toThrow();
  });
});

describe("loadDomain", () => {
  it("loads a valid domain", () => {
    const domain = loadDomain(join(fixturesDir, "domains", "test-domain"));
    expect(domain.id).toBe("test-domain");
    expect(domain.overlays.catalyst).toBeDefined();
    expect(domain.overlays.catalyst.thinking_patterns).toHaveLength(1);
  });

  it("throws on missing domain.yaml", () => {
    expect(() => loadDomain("/nonexistent/path")).toThrow();
  });
});

describe("validateBrief", () => {
  it("validates a brief with all required sections", () => {
    const briefPath = join(fixturesDir, "briefs", "test-brief", "brief.md");
    const requiredSections = [
      { heading: "## Situation", guidance: "" },
      { heading: "## Key Question", guidance: "" },
    ];
    const result = validateBrief(briefPath, requiredSections);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("reports missing sections", () => {
    const briefPath = join(fixturesDir, "briefs", "test-brief", "brief.md");
    const requiredSections = [
      { heading: "## Situation", guidance: "" },
      { heading: "## Stakes", guidance: "What's at risk?" },
      { heading: "## Key Question", guidance: "" },
    ];
    const result = validateBrief(briefPath, requiredSections);
    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].heading).toBe("## Stakes");
  });
});
