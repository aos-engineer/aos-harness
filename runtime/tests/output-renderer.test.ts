import { describe, it, expect } from "bun:test";
import { renderExecutionPackage } from "../src/output-renderer";
import type { ArtifactManifest } from "../src/types";

describe("renderExecutionPackage", () => {
  it("renders complete execution package with frontmatter", () => {
    const artifacts = new Map();
    artifacts.set("requirements_analysis", {
      manifest: {
        schema: "aos/artifact/v1",
        id: "requirements_analysis",
        produced_by: ["advocate"],
        step_id: "understand",
        format: "markdown",
        content_path: "/tmp/req.md",
        metadata: {
          produced_at: "2026-03-24T00:00:00Z",
          review_status: "approved",
          review_gate: "understand",
          word_count: 50,
          revision: 1,
        },
      },
      content: "# User Stories\n\nAs a user, I want to...",
    });

    const result = renderExecutionPackage({
      profile: "cto-execution",
      workflow: "cto-execution-workflow",
      sessionId: "abc123",
      domain: null,
      participants: ["architect", "advocate"],
      briefPath: "briefs/test/brief.md",
      transcriptPath: "sessions/test/transcript.jsonl",
      durationMinutes: 12.5,
      stepsCompleted: ["understand"],
      gatesPassed: ["understand"],
      artifacts,
      executiveSummary: "We are building a new auth system.",
    });

    expect(result).toContain("schema: aos/output/v1");
    expect(result).toContain("profile: cto-execution");
    expect(result).toContain("workflow: cto-execution-workflow");
    expect(result).toContain("phases_completed:");
    expect(result).toContain("gates_passed:");
    expect(result).toContain("# Execution Package");
    expect(result).toContain("We are building a new auth system.");
    expect(result).toContain("As a user, I want to...");
  });

  it("uses default sections when none specified", () => {
    const result = renderExecutionPackage({
      profile: "test",
      workflow: "test-workflow",
      sessionId: "xyz",
      domain: null,
      participants: [],
      briefPath: "",
      transcriptPath: "",
      durationMinutes: 0,
      stepsCompleted: [],
      gatesPassed: [],
      artifacts: new Map(),
    });

    expect(result).toContain("## 1. Requirements Analysis");
    expect(result).toContain("## 2. Architecture Decision Record");
    expect(result).toContain("## 7. Implementation Checklist");
  });

  it("shows 'Not produced' for missing artifacts", () => {
    const result = renderExecutionPackage({
      profile: "test",
      workflow: "test-workflow",
      sessionId: "xyz",
      domain: null,
      participants: [],
      briefPath: "",
      transcriptPath: "",
      durationMinutes: 0,
      stepsCompleted: [],
      gatesPassed: [],
      artifacts: new Map(),
    });

    expect(result).toContain("*Not produced in this session.*");
  });

  it("uses custom sections when provided", () => {
    const result = renderExecutionPackage({
      profile: "test",
      workflow: "test-workflow",
      sessionId: "xyz",
      domain: null,
      participants: [],
      briefPath: "",
      transcriptPath: "",
      durationMinutes: 0,
      stepsCompleted: [],
      gatesPassed: [],
      artifacts: new Map(),
      sections: ["requirements_analysis", "task_breakdown"],
    });

    expect(result).toContain("## 1. Requirements Analysis");
    expect(result).toContain("## 2. Task Breakdown");
    expect(result).not.toContain("Architecture Decision Record");
  });
});
