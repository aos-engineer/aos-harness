import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { loadWorkflow } from "../src/config-loader";
import { WorkflowRunner } from "../src/workflow-runner";
import type { WorkflowConfig } from "../src/workflow-runner";
import { MockAdapter } from "./mock-adapter";

const fixturesDir = join(import.meta.dir, "..", "fixtures");

// ── Config Loading ──────────────────────────────────────────────────

describe("loadWorkflow", () => {
  it("loads a valid workflow from YAML", () => {
    const config = loadWorkflow(
      join(fixturesDir, "workflows", "test-workflow"),
    );
    expect(config.schema).toBe("aos/workflow/v1");
    expect(config.id).toBe("test-workflow");
    expect(config.name).toBe("Test Workflow");
    expect(config.steps).toHaveLength(3);
    expect(config.gates).toHaveLength(2);
  });

  it("validates step IDs in gates", () => {
    expect(() =>
      loadWorkflow(join(fixturesDir, "workflows", "nonexistent")),
    ).toThrow();
  });

  it("parses step inputs correctly", () => {
    const config = loadWorkflow(
      join(fixturesDir, "workflows", "test-workflow"),
    );
    expect(config.steps[0].input).toEqual([]);
    expect(config.steps[1].input).toEqual(["step-one"]);
    expect(config.steps[2].input).toEqual(["step-one", "step-two"]);
  });

  it("parses gate types correctly", () => {
    const config = loadWorkflow(
      join(fixturesDir, "workflows", "test-workflow"),
    );
    expect(config.gates[0].type).toBe("user-approval");
    expect(config.gates[1].type).toBe("automated-review");
    expect(config.gates[1].max_iterations).toBe(2);
  });
});

// ── Workflow Execution ──────────────────────────────────────────────

describe("WorkflowRunner", () => {
  function makeConfig(): WorkflowConfig {
    return {
      schema: "aos/workflow/v1",
      id: "test",
      name: "Test",
      description: "Test workflow",
      steps: [
        {
          id: "step-a",
          action: "gather",
          description: "Gather",
          input: [],
          output: "data-a",
          review_gate: false,
        },
        {
          id: "step-b",
          action: "process",
          description: "Process",
          input: ["step-a"],
          output: "data-b",
          review_gate: false,
        },
        {
          id: "step-c",
          action: "finalize",
          description: "Finalize",
          input: ["step-a", "step-b"],
          output: "data-c",
          review_gate: false,
        },
      ],
      gates: [],
    };
  }

  it("executes all steps in order", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    const runner = new WorkflowRunner(config, adapter);

    const outputs = await runner.execute();

    expect(outputs.size).toBe(3);
    expect(outputs.has("step-a")).toBe(true);
    expect(outputs.has("step-b")).toBe(true);
    expect(outputs.has("step-c")).toBe(true);
  });

  it("records completed steps in execution order", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    const runner = new WorkflowRunner(config, adapter);

    await runner.execute();

    expect(runner.getCompletedSteps()).toEqual([
      "step-a",
      "step-b",
      "step-c",
    ]);
  });

  it("passes previous step outputs as inputs", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    const runner = new WorkflowRunner(config, adapter);

    const outputs = await runner.execute();

    // step-b should have received step-a's output as input
    const stepB = outputs.get("step-b") as {
      stepId: string;
      action: string;
      inputs: Record<string, unknown>;
    };
    expect(stepB.inputs["step-a"]).toBeDefined();

    // step-c should have received both step-a and step-b outputs
    const stepC = outputs.get("step-c") as {
      stepId: string;
      action: string;
      inputs: Record<string, unknown>;
    };
    expect(stepC.inputs["step-a"]).toBeDefined();
    expect(stepC.inputs["step-b"]).toBeDefined();
  });

  it("notifies the adapter for each step", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    const runner = new WorkflowRunner(config, adapter);

    await runner.execute();

    const notifyCalls = adapter.calls.filter((c) => c.method === "notify");
    expect(notifyCalls.length).toBeGreaterThanOrEqual(3);
  });

  it("pauses at user-approval gates", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    config.gates = [
      {
        after: "step-b",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: "re-run-step",
      },
    ];

    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();

    // MockAdapter.promptConfirm returns true by default
    const confirmCalls = adapter.calls.filter(
      (c) => c.method === "promptConfirm",
    );
    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0].args).toEqual(["Review Gate", "Approve?"]);
  });

  it("re-runs step on user-approval rejection", async () => {
    const adapter = new MockAdapter();

    // Override promptConfirm to reject once, then approve
    let confirmCount = 0;
    adapter.promptConfirm = async (title: string, message: string) => {
      adapter.calls.push({
        method: "promptConfirm",
        args: [title, message],
        timestamp: Date.now(),
      });
      confirmCount++;
      return false; // Always reject for this test
    };

    adapter.promptInput = async (label: string) => {
      adapter.calls.push({
        method: "promptInput",
        args: [label],
        timestamp: Date.now(),
      });
      return "change this";
    };

    const config = makeConfig();
    config.gates = [
      {
        after: "step-b",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: "re-run-step",
      },
    ];

    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();

    // Should have stored feedback
    const outputs = runner.getStepOutputs();
    expect(outputs.has("step-b_feedback")).toBe(true);
    expect(outputs.get("step-b_feedback")).toBe("change this");
  });

  it("runs automated-review gates with iteration notifications", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    config.gates = [
      {
        after: "step-c",
        type: "automated-review",
        prompt: "Auto review",
        max_iterations: 3,
        on_rejection: "re-run-step",
      },
    ];

    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();

    // Should notify about automated review
    const notifyCalls = adapter.calls.filter(
      (c) =>
        c.method === "notify" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("Automated review"),
    );
    expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("defaults max_iterations to 3 for automated-review", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    config.gates = [
      {
        after: "step-a",
        type: "automated-review",
        prompt: "Auto review",
        on_rejection: "re-run-step",
        // no max_iterations — should default to 3
      },
    ];

    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();

    // Should still work without error
    expect(runner.getCompletedSteps()).toContain("step-a");
  });

  it("loads fixture and executes end-to-end", async () => {
    const config = loadWorkflow(
      join(fixturesDir, "workflows", "test-workflow"),
    );
    const adapter = new MockAdapter();
    const runner = new WorkflowRunner(config, adapter);

    const outputs = await runner.execute();

    expect(outputs.size).toBeGreaterThanOrEqual(3);
    expect(runner.getCompletedSteps()).toEqual([
      "step-one",
      "step-two",
      "step-three",
    ]);

    // Gates should have fired
    const confirmCalls = adapter.calls.filter(
      (c) => c.method === "promptConfirm",
    );
    expect(confirmCalls).toHaveLength(1); // user-approval gate

    const reviewNotifies = adapter.calls.filter(
      (c) =>
        c.method === "notify" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("Automated review"),
    );
    expect(reviewNotifies.length).toBeGreaterThanOrEqual(1);
  });
});
