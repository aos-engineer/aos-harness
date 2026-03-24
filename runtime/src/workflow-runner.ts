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

// ── Workflow Config Types ──────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  name?: string;
  action: string;
  description: string;
  agents?: string[];
  prompt?: string;
  structural_advantage?: "speaks-last" | null;
  input: string[];
  output: string;
  review_gate: boolean;
}

export interface WorkflowGate {
  after: string;
  type: "user-approval" | "automated-review";
  prompt: string;
  max_iterations?: number;
  on_rejection: "re-run-step" | "retry_with_feedback";
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

  constructor(config: WorkflowConfig, adapter: AOSAdapter) {
    this.config = config;
    this.adapter = adapter;
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
    for (const inputId of step.input) {
      inputs[inputId] = this.stepOutputs.get(inputId);
    }

    // Execute the step
    const output = await this.executeStep(step, inputs);
    this.stepOutputs.set(step.id, output);
    this.completedSteps.push(step.id);

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
      `[${this.config.id}] Step: ${step.description}`,
      "info",
    );
    return { stepId: step.id, action: step.action, inputs };
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
