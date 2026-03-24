import { describe, it, expect } from "bun:test";
import { resolveTemplate } from "../src/template-resolver";

describe("resolveTemplate", () => {
  it("replaces single variable", () => {
    expect(resolveTemplate("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  it("replaces multiple variables", () => {
    const result = resolveTemplate("{{a}} and {{b}}", { a: "X", b: "Y" });
    expect(result).toBe("X and Y");
  });

  it("replaces same variable multiple times", () => {
    const result = resolveTemplate("{{x}} then {{x}}", { x: "Z" });
    expect(result).toBe("Z then Z");
  });

  it("leaves unknown variables as-is", () => {
    expect(resolveTemplate("{{known}} {{unknown}}", { known: "yes" })).toBe("yes {{unknown}}");
  });

  it("handles empty variables map", () => {
    expect(resolveTemplate("{{a}}", {})).toBe("{{a}}");
  });

  it("handles template with no variables", () => {
    expect(resolveTemplate("no vars here", { a: "unused" })).toBe("no vars here");
  });

  it("handles empty string", () => {
    expect(resolveTemplate("", { a: "b" })).toBe("");
  });

  it("handles multiline templates", () => {
    const template = "Line 1: {{x}}\nLine 2: {{y}}";
    expect(resolveTemplate(template, { x: "A", y: "B" })).toBe("Line 1: A\nLine 2: B");
  });

  it("resolves all spec-defined variables", () => {
    const vars = {
      date: "2026-03-23",
      session_id: "abc123",
      brief_slug: "test-brief",
      brief: "# Brief content",
      format: "memo",
      agent_id: "catalyst",
      agent_name: "Catalyst",
      profile_id: "strategic-council",
      domain_id: "saas",
      participants: "catalyst, sentinel, architect",
      constraints: "2-10 min | $1-$10 | 2-8 rounds",
      expertise_block: "- scratch-pad.md [read-write]",
      skills_block: "",
      output_path: "/output/memos/memo.md",
      deliberation_dir: "/sessions/abc123",
      transcript_path: "/sessions/abc123/transcript.jsonl",
    };
    const template = "Session {{session_id}} for {{profile_id}}";
    expect(resolveTemplate(template, vars)).toBe("Session abc123 for strategic-council");
  });
});
