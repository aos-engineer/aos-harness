import { describe, it, expect } from "bun:test";
import {
  type AgentConfig,
  type ProfileConfig,
  type DomainConfig,
  type ConstraintState,
  type AgentResponse,
  type AuthMode,
  type ModelCost,
  type DelegationTarget,
  type AgentCapabilities,
  type ArtifactManifest,
  type LoadedArtifact,
  type ExecuteCodeOpts,
  type ExecutionResult,
  type SkillInput,
  type SkillResult,
  type ReviewResult,
  type ReviewIssue,
  type AssemblyMember,
  type TranscriptEventType,
  isConstraintConflict,
  isMetered,
  createDefaultConstraintState,
  UnsupportedError,
} from "../src/types";
import { MockAdapter } from "./mock-adapter";

describe("ConstraintState", () => {
  it("createDefaultConstraintState returns zeroed state", () => {
    const state = createDefaultConstraintState();
    expect(state.elapsed_minutes).toBe(0);
    expect(state.budget_spent).toBe(0);
    expect(state.rounds_completed).toBe(0);
    expect(state.past_all_minimums).toBe(false);
    expect(state.hit_maximum).toBe(false);
    expect(state.can_end).toBe(false);
    expect(state.bias_ratio).toBe(0);
    expect(state.bias_blocked).toBe(false);
    expect(state.metered).toBe(true);
  });

  it("isConstraintConflict detects budget max before time min", () => {
    const state = createDefaultConstraintState();
    state.hit_maximum = true;
    state.hit_reason = "constraint_conflict";
    state.conflict_detail = "budget_max hit before time_min met";
    expect(isConstraintConflict(state)).toBe(true);
  });

  it("isConstraintConflict returns false for normal hit", () => {
    const state = createDefaultConstraintState();
    state.hit_maximum = true;
    state.hit_reason = "time";
    expect(isConstraintConflict(state)).toBe(false);
  });
});

describe("AuthMode", () => {
  it("isMetered returns true for api_key auth", () => {
    const auth: AuthMode = { type: "api_key", metered: true };
    expect(isMetered(auth)).toBe(true);
  });

  it("isMetered returns false for subscription auth", () => {
    const auth: AuthMode = { type: "subscription", metered: false, subscription_tier: "max" };
    expect(isMetered(auth)).toBe(false);
  });
});

describe("AgentCapabilities", () => {
  it("can create a capabilities object with all fields", () => {
    const caps: AgentCapabilities = {
      can_execute_code: true,
      can_produce_files: true,
      can_review_artifacts: true,
      available_skills: ["run-tests", "security-scan"],
      output_types: ["text", "markdown", "code"],
    };
    expect(caps.can_execute_code).toBe(true);
    expect(caps.available_skills).toHaveLength(2);
    expect(caps.output_types).toContain("code");
  });

  it("capabilities is optional on AgentConfig", () => {
    const config = {
      schema: "aos/agent/v1",
      id: "test",
      name: "Test",
      role: "tester",
      cognition: {
        objective_function: "test",
        time_horizon: { primary: "short", secondary: "medium", peripheral: "long" },
        core_bias: "none",
        risk_tolerance: "moderate" as const,
        default_stance: "neutral",
      },
      persona: {
        temperament: [],
        thinking_patterns: [],
        heuristics: [],
        evidence_standard: { convinced_by: [], not_convinced_by: [] },
        red_lines: [],
      },
      tensions: [],
      report: { structure: "freeform" },
      tools: null,
      skills: [],
      expertise: [],
      model: { tier: "standard" as const, thinking: "on" as const },
    } satisfies AgentConfig;
    expect(config.capabilities).toBeUndefined();
  });
});

describe("AssemblyMember", () => {
  it("supports role_override field", () => {
    const member: AssemblyMember = {
      agent: "architect",
      required: true,
      structural_advantage: "speaks-last",
      role_override: "Produce architecture decision records",
    };
    expect(member.role_override).toBe("Produce architecture decision records");
  });

  it("role_override defaults to undefined when not set", () => {
    const member: AssemblyMember = {
      agent: "catalyst",
      required: false,
    };
    expect(member.role_override).toBeUndefined();
  });

  it("role_override can be null", () => {
    const member: AssemblyMember = {
      agent: "sentinel",
      required: true,
      role_override: null,
    };
    expect(member.role_override).toBeNull();
  });
});

describe("ProfileConfig workflow field", () => {
  it("workflow is optional on ProfileConfig", () => {
    // Type check: workflow field is optional
    const partial: Pick<ProfileConfig, "workflow"> = {};
    expect(partial.workflow).toBeUndefined();
  });

  it("workflow can be a string or null", () => {
    const withWorkflow: Pick<ProfileConfig, "workflow"> = { workflow: "cto-execution-workflow" };
    expect(withWorkflow.workflow).toBe("cto-execution-workflow");

    const withNull: Pick<ProfileConfig, "workflow"> = { workflow: null };
    expect(withNull.workflow).toBeNull();
  });
});

describe("ArtifactManifest", () => {
  it("can create a valid artifact manifest", () => {
    const manifest: ArtifactManifest = {
      schema: "aos/artifact/v1",
      id: "requirements_analysis",
      produced_by: ["advocate", "strategist"],
      step_id: "understand",
      format: "markdown",
      content_path: "artifacts/requirements_analysis.md",
      metadata: {
        produced_at: "2026-03-24T14:30:00Z",
        review_status: "approved",
        review_gate: "understand",
        word_count: 1250,
        revision: 1,
      },
    };
    expect(manifest.schema).toBe("aos/artifact/v1");
    expect(manifest.produced_by).toHaveLength(2);
    expect(manifest.metadata.review_status).toBe("approved");
  });

  it("metadata supports additional properties", () => {
    const manifest: ArtifactManifest = {
      schema: "aos/artifact/v1",
      id: "test",
      produced_by: ["agent1"],
      step_id: "step1",
      format: "code",
      content_path: "artifacts/test.ts",
      metadata: {
        produced_at: "2026-03-24T14:30:00Z",
        review_status: "pending",
        review_gate: null,
        word_count: 100,
        revision: 1,
        custom_field: "custom_value",
      },
    };
    expect(manifest.metadata.custom_field).toBe("custom_value");
  });
});

describe("LoadedArtifact", () => {
  it("combines manifest and content", () => {
    const loaded: LoadedArtifact = {
      manifest: {
        schema: "aos/artifact/v1",
        id: "test",
        produced_by: ["agent1"],
        step_id: "step1",
        format: "markdown",
        content_path: "artifacts/test.md",
        metadata: {
          produced_at: "2026-03-24T14:30:00Z",
          review_status: "pending",
          review_gate: null,
          word_count: 5,
          revision: 1,
        },
      },
      content: "Hello world",
    };
    expect(loaded.content).toBe("Hello world");
    expect(loaded.manifest.id).toBe("test");
  });
});

describe("Execution adapter types", () => {
  it("ExecuteCodeOpts has all optional fields", () => {
    const opts: ExecuteCodeOpts = {};
    expect(opts.language).toBeUndefined();
    expect(opts.timeout_ms).toBeUndefined();

    const full: ExecuteCodeOpts = {
      language: "typescript",
      timeout_ms: 30000,
      cwd: "/tmp",
      env: { NODE_ENV: "test" },
      sandbox: "strict",
    };
    expect(full.language).toBe("typescript");
    expect(full.sandbox).toBe("strict");
  });

  it("ExecutionResult has required fields", () => {
    const result: ExecutionResult = {
      success: true,
      exit_code: 0,
      stdout: "ok",
      stderr: "",
      duration_ms: 123,
    };
    expect(result.success).toBe(true);
    expect(result.files_created).toBeUndefined();
  });

  it("SkillInput has all optional fields", () => {
    const input: SkillInput = {};
    expect(input.args).toBeUndefined();

    const full: SkillInput = {
      args: "--verbose",
      context: { key: "value" },
      artifacts: ["artifact1"],
    };
    expect(full.artifacts).toHaveLength(1);
  });

  it("SkillResult has required and optional fields", () => {
    const result: SkillResult = {
      success: true,
      output: "done",
    };
    expect(result.error).toBeUndefined();
  });

  it("ReviewResult has required and optional fields", () => {
    const approved: ReviewResult = {
      status: "approved",
      reviewer: "sentinel",
    };
    expect(approved.feedback).toBeUndefined();

    const rejected: ReviewResult = {
      status: "rejected",
      feedback: "Needs more detail",
      reviewer: "sentinel",
      issues: [
        { severity: "major", description: "Missing error handling", location: "src/main.ts" },
        { severity: "suggestion", description: "Consider adding types" },
      ],
    };
    expect(rejected.issues).toHaveLength(2);
    expect(rejected.issues![0].severity).toBe("major");
  });
});

describe("UnsupportedError", () => {
  it("creates error with method name", () => {
    const err = new UnsupportedError("executeCode");
    expect(err.name).toBe("UnsupportedError");
    expect(err.message).toContain("executeCode");
    expect(err).toBeInstanceOf(Error);
  });

  it("creates error with custom message", () => {
    const err = new UnsupportedError("invokeSkill", "Skills not available on this platform");
    expect(err.message).toBe("Skills not available on this platform");
  });
});

describe("TranscriptEventType", () => {
  it("includes workflow event types", () => {
    const workflowEvents: TranscriptEventType[] = [
      "workflow_start",
      "step_start",
      "step_end",
      "gate_prompt",
      "gate_result",
      "artifact_write",
      "workflow_end",
    ];
    // Type check passes if this compiles
    expect(workflowEvents).toHaveLength(7);
  });

  it("includes execution event types", () => {
    const executionEvents: TranscriptEventType[] = [
      "code_execution",
      "skill_invocation",
      "review_submission",
    ];
    expect(executionEvents).toHaveLength(3);
  });

  it("includes all original event types", () => {
    const originalEvents: TranscriptEventType[] = [
      "session_start",
      "agent_spawn",
      "delegation",
      "response",
      "constraint_check",
      "constraint_warning",
      "budget_estimate",
      "budget_abort",
      "steer",
      "error",
      "expertise_write",
      "end_session",
      "final_statement",
      "agent_destroy",
      "session_end",
    ];
    expect(originalEvents).toHaveLength(15);
  });
});

describe("MockAdapter execution methods", () => {
  it("executeCode records call and returns default result", async () => {
    const adapter = new MockAdapter();
    const handle = await adapter.spawnAgent(
      {
        schema: "aos/agent/v1",
        id: "dev",
        name: "Developer",
        role: "developer",
        cognition: {
          objective_function: "test",
          time_horizon: { primary: "s", secondary: "m", peripheral: "l" },
          core_bias: "none",
          risk_tolerance: "moderate",
          default_stance: "neutral",
        },
        persona: {
          temperament: [],
          thinking_patterns: [],
          heuristics: [],
          evidence_standard: { convinced_by: [], not_convinced_by: [] },
          red_lines: [],
        },
        tensions: [],
        report: { structure: "freeform" },
        tools: null,
        skills: [],
        expertise: [],
        model: { tier: "standard", thinking: "on" },
      },
      "session-1",
    );

    const result = await adapter.executeCode(handle, "console.log('hello')");
    expect(result.success).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(adapter.calls.some((c) => c.method === "executeCode")).toBe(true);
  });

  it("invokeSkill records call and returns default result", async () => {
    const adapter = new MockAdapter();
    const handle = { id: "h1", agentId: "dev", sessionId: "s1" };
    const result = await adapter.invokeSkill(handle, "run-tests", { args: "--all" });
    expect(result.success).toBe(true);
    expect(adapter.calls.some((c) => c.method === "invokeSkill")).toBe(true);
  });

  it("createArtifact records call", async () => {
    const adapter = new MockAdapter();
    const manifest: ArtifactManifest = {
      schema: "aos/artifact/v1",
      id: "test-artifact",
      produced_by: ["dev"],
      step_id: "step1",
      format: "markdown",
      content_path: "artifacts/test.md",
      metadata: {
        produced_at: new Date().toISOString(),
        review_status: "pending",
        review_gate: null,
        word_count: 100,
        revision: 1,
      },
    };
    await adapter.createArtifact(manifest, "# Test Content");
    expect(adapter.calls.some((c) => c.method === "createArtifact")).toBe(true);
  });

  it("loadArtifact records call and returns default artifact", async () => {
    const adapter = new MockAdapter();
    const loaded = await adapter.loadArtifact("test-artifact", "/tmp/session");
    expect(loaded.manifest.id).toBe("test-artifact");
    expect(loaded.manifest.schema).toBe("aos/artifact/v1");
    expect(adapter.calls.some((c) => c.method === "loadArtifact")).toBe(true);
  });

  it("submitForReview records call and returns approved", async () => {
    const adapter = new MockAdapter();
    const reviewer = { id: "h1", agentId: "sentinel", sessionId: "s1" };
    const loaded = await adapter.loadArtifact("test", "/tmp");
    const result = await adapter.submitForReview(loaded, reviewer, "Review this artifact");
    expect(result.status).toBe("approved");
    expect(result.reviewer).toBe("sentinel");
    expect(adapter.calls.some((c) => c.method === "submitForReview")).toBe(true);
  });
});
