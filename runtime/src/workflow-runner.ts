/**
 * WorkflowRunner — loads and executes workflow definitions.
 *
 * Workflows are sequences of steps with optional gates (user-approval or
 * automated-review) that pause execution for human or automated review.
 *
 * The runner delegates actual work to the AOSAdapter — it is a framework
 * that interprets step actions and orchestrates the flow, not the executor.
 */

import type { AOSAdapter } from "./types";
import { UnsupportedError } from "./types";
import { ArtifactManager } from "./artifact-manager";

// ── Workflow Config Types ──────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  name?: string;
  action: string;
  description?: string;
  agents?: string[];
  prompt?: string;
  structural_advantage?: "speaks-last" | null;
  input?: string[];
  output?: string;
  review_gate?: boolean;
}

export interface WorkflowGate {
  after: string;
  type: "user-approval" | "automated-review";
  prompt: string;
  max_iterations?: number;
  on_rejection?: "re-run-step" | "retry_with_feedback";
}

export interface WorkflowConfig {
  schema: string;
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  gates: WorkflowGate[];
}

// ── Workflow Runner ────────────────────────────────────────────────

export class WorkflowRunner {
  private config: WorkflowConfig;
  private adapter: AOSAdapter;
  private stepOutputs: Map<string, unknown> = new Map();
  private completedSteps: string[] = [];
  private sessionDir?: string;
  private artifactManager?: ArtifactManager;

  constructor(config: WorkflowConfig, adapter: AOSAdapter, opts?: { sessionDir?: string }) {
    this.config = config;
    this.adapter = adapter;
    if (opts?.sessionDir) {
      this.sessionDir = opts.sessionDir;
      this.artifactManager = new ArtifactManager(adapter, opts.sessionDir);
    }
  }

  /**
   * Execute the full workflow, step by step, respecting gates.
   * Returns a map of step IDs to their outputs.
   */
  async execute(): Promise<Map<string, unknown>> {
    for (const step of this.config.steps) {
      await this.runStep(step);
    }

    return this.stepOutputs;
  }

  /**
   * Get the outputs collected so far (useful for inspection mid-workflow).
   */
  getStepOutputs(): Map<string, unknown> {
    return new Map(this.stepOutputs);
  }

  /**
   * Get the list of completed step IDs in execution order.
   */
  getCompletedSteps(): string[] {
    return [...this.completedSteps];
  }

  // ── Private ────────────────────────────────────────────────────────

  private async runStep(step: WorkflowStep): Promise<void> {
    // Gather inputs from previous steps
    const inputs: Record<string, unknown> = {};
    for (const inputId of (step.input ?? [])) {
      inputs[inputId] = this.stepOutputs.get(inputId);
    }

    // Artifact injection: load referenced artifacts into context
    if (this.artifactManager && step.input && step.input.length > 0) {
      for (const inputId of step.input) {
        try {
          const formatted = await this.artifactManager.formatForInjection(inputId);
          inputs[`__artifact_${inputId}`] = formatted;
        } catch {
          // Artifact may not exist (e.g., step output without artifact) — skip
        }
      }
    }

    // Execute the step
    const output = await this.executeStep(step, inputs);
    this.stepOutputs.set(step.id, output);
    this.completedSteps.push(step.id);

    // Create artifact from step output if artifact manager is available
    if (this.artifactManager && step.output) {
      const content = typeof output === "string"
        ? output
        : JSON.stringify(output, null, 2);
      await this.artifactManager.createArtifact(step.output, content, {
        produced_by: step.agents ?? ["orchestrator"],
        step_id: step.id,
        format: "markdown",
      });
    }

    // Check for gate after this step
    const gate = this.config.gates.find((g) => g.after === step.id);
    if (gate) {
      await this.executeGate(gate, step, inputs);
    }
  }

  private async executeStep(
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<unknown> {
    this.adapter.notify(
      `[${this.config.id}] Step: ${step.description ?? step.id}`,
      "info",
    );

    switch (step.action) {
      case "targeted-delegation":
        return this.executeTargetedDelegation(step, inputs);

      case "tension-pair":
        return this.executeTensionPair(step, inputs);

      case "orchestrator-synthesis":
        return this.executeOrchestratorSynthesis(step, inputs);

      case "execute-with-tools":
        return this.executeWithTools(step, inputs);

      default:
        // Existing behavior for "gather", "process", etc.
        return { stepId: step.id, action: step.action, inputs };
    }
  }

  private async executeTargetedDelegation(
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<unknown> {
    const agents = step.agents ?? [];
    const prompt = step.prompt ?? "";

    this.adapter.notify(
      `[${this.config.id}] Targeted delegation to [${agents.join(", ")}]: ${prompt}`,
      "info",
    );

    return {
      stepId: step.id,
      action: step.action,
      agents,
      prompt,
      inputs,
    };
  }

  private async executeTensionPair(
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<unknown> {
    const agents = step.agents ?? [];

    if (agents.length !== 2) {
      this.adapter.notify(
        `[${this.config.id}] tension-pair requires exactly 2 agents, got ${agents.length}`,
        "error",
      );
      throw new Error(
        `tension-pair step "${step.id}" requires exactly 2 agents, got ${agents.length}`,
      );
    }

    const prompt = step.prompt ?? "";

    this.adapter.notify(
      `[${this.config.id}] Tension pair [${agents[0]} vs ${agents[1]}]: ${prompt}`,
      "info",
    );

    return {
      stepId: step.id,
      action: step.action,
      agents,
      prompt,
      inputs,
    };
  }

  private async executeOrchestratorSynthesis(
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<unknown> {
    const prompt = step.prompt ?? "";

    // Collect all input artifacts
    const collectedInputs: Record<string, unknown> = {};
    for (const inputId of (step.input ?? [])) {
      collectedInputs[inputId] = this.stepOutputs.get(inputId);
    }

    this.adapter.notify(
      `[${this.config.id}] Orchestrator synthesis: ${prompt} (inputs: ${Object.keys(collectedInputs).join(", ")})`,
      "info",
    );

    return {
      stepId: step.id,
      action: step.action,
      prompt,
      synthesis_inputs: collectedInputs,
    };
  }

  private async executeWithTools(
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<unknown> {
    const prompt = step.prompt ?? "";

    this.adapter.notify(
      `[${this.config.id}] Execute with tools: ${prompt}`,
      "info",
    );

    // Attempt code execution or skill invocation via the adapter.
    // These may not be supported by all adapters — catch UnsupportedError gracefully.
    let executionResult: unknown = null;

    try {
      // Create a temporary handle for execution
      const handle = await this.adapter.spawnAgent(
        {
          schema: "aos/agent/v1",
          id: `${step.id}-executor`,
          name: step.name ?? step.id,
          role: "executor",
          cognition: {
            objective_function: "execute",
            time_horizon: { primary: "immediate", secondary: "", peripheral: "" },
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
          report: { structure: "flat" },
          tools: null,
          skills: [],
          expertise: [],
          model: { tier: "standard", thinking: "off" },
        },
        this.config.id,
      );

      try {
        executionResult = await this.adapter.executeCode(handle, prompt);
      } catch (err) {
        if (err instanceof UnsupportedError) {
          this.adapter.notify(
            `[${this.config.id}] executeCode not supported, skipping`,
            "info",
          );
        } else {
          throw err;
        }
      }

      await this.adapter.destroyAgent(handle);
    } catch (err) {
      if (err instanceof UnsupportedError) {
        this.adapter.notify(
          `[${this.config.id}] Execution adapter not available, skipping`,
          "info",
        );
      } else {
        throw err;
      }
    }

    return {
      stepId: step.id,
      action: step.action,
      prompt,
      executionResult,
      inputs,
    };
  }

  private async executeGate(
    gate: WorkflowGate,
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<void> {
    if (gate.type === "user-approval") {
      await this.executeUserApprovalGate(gate, step, inputs);
    } else if (gate.type === "automated-review") {
      await this.executeAutomatedReviewGate(gate, step, inputs);
    }
  }

  private async executeUserApprovalGate(
    gate: WorkflowGate,
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<void> {
    const approved = await this.adapter.promptConfirm("Review Gate", gate.prompt);

    if (!approved) {
      // Collect feedback and re-run the step
      const feedback = await this.adapter.promptInput("What should change?");
      this.stepOutputs.set(`${step.id}_feedback`, feedback);

      // Re-execute the step with updated inputs (feedback is now available)
      inputs[`${step.id}_feedback`] = feedback;
      const output = await this.executeStep(step, inputs);
      this.stepOutputs.set(step.id, output);
    }
  }

  private async executeAutomatedReviewGate(
    gate: WorkflowGate,
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<void> {
    const maxIterations = gate.max_iterations ?? 3;

    for (let i = 0; i < maxIterations; i++) {
      this.adapter.notify(
        `[${this.config.id}] Automated review iteration ${i + 1}/${maxIterations}`,
        "info",
      );

      // In a real implementation, the adapter dispatches a reviewer agent
      // and checks whether the review passes. For now, the framework
      // notifies and breaks — real review logic is adapter-specific.
      break;
    }
  }
}
