/**
 * AOSEngine — composes all runtime modules into a session lifecycle.
 *
 * Responsibilities:
 * - Load profile, agents, optional domain overlay
 * - Validate briefs
 * - Delegate messages with routing, constraint checking, and transcript recording
 * - Enforce session end guards (minimums must be met or a maximum hit)
 */

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  AOSAdapter,
  AgentConfig,
  AgentHandle,
  AgentResponse,
  ConstraintState,
  TranscriptEntry,
} from "./types";
import { loadProfile, loadAgent, loadDomain, loadWorkflow, validateBrief } from "./config-loader";
import { ConstraintEngine } from "./constraint-engine";
import { DelegationRouter } from "./delegation-router";
import type { DelegationTarget } from "./delegation-router";
import { applyDomain } from "./domain-merger";
import { WorkflowRunner } from "./workflow-runner";
import type { WorkflowConfig } from "./workflow-runner";
import { renderExecutionPackage } from "./output-renderer";
import type { ArtifactManifest } from "./types";

export interface EngineOpts {
  agentsDir: string;
  domain?: string;
  domainDir?: string;
  workflowsDir?: string;
}

export class AOSEngine {
  private adapter: AOSAdapter;
  private profile: ReturnType<typeof loadProfile>;
  private agents: Map<string, AgentConfig> = new Map();
  private handles: Map<string, AgentHandle> = new Map();
  private constraintEngine: ConstraintEngine;
  private delegationRouter: DelegationRouter;
  private transcript: TranscriptEntry[] = [];
  private startTime: number = 0;
  private roundNumber: number = 0;
  private sessionId: string;
  private speaksLastAgent: string | null = null;
  private domainId: string | null = null;
  private workflowMode: boolean = false;
  private workflowConfig: WorkflowConfig | null = null;
  private workflowsDir: string | null = null;

  constructor(adapter: AOSAdapter, profilePath: string, opts: EngineOpts) {
    this.adapter = adapter;
    this.sessionId = this.generateSessionId();

    // Load profile
    this.profile = loadProfile(profilePath);

    // Load all agents referenced in profile
    const agentIds = [
      this.profile.assembly.orchestrator,
      ...this.profile.assembly.perspectives.map((p) => p.agent),
    ];

    let agentConfigs: AgentConfig[] = [];
    for (const agentId of agentIds) {
      const agentDir = join(opts.agentsDir, agentId);
      const config = loadAgent(agentDir);
      agentConfigs.push(config);
    }

    // Apply domain overlay if provided
    if (opts.domain && opts.domainDir) {
      const domainDir = join(opts.domainDir, opts.domain);
      const domainConfig = loadDomain(domainDir);
      agentConfigs = applyDomain(agentConfigs, domainConfig);
      this.domainId = opts.domain;
    }

    // Store agents by ID
    for (const config of agentConfigs) {
      this.agents.set(config.id, config);
    }

    // Find speaks-last agent
    for (const p of this.profile.assembly.perspectives) {
      if (p.structural_advantage === "speaks-last") {
        this.speaksLastAgent = p.agent;
      }
    }

    // Initialize constraint engine
    const authMode = adapter.getAuthMode();
    this.constraintEngine = new ConstraintEngine(this.profile.constraints, authMode);

    // Initialize delegation router
    this.delegationRouter = new DelegationRouter(
      this.profile.assembly.perspectives,
      this.profile.delegation.tension_pairs,
      this.profile.delegation.bias_limit,
      this.profile.delegation.opening_rounds,
    );

    // Detect workflow mode
    if (this.profile.workflow) {
      this.workflowMode = true;
      this.workflowsDir = opts.workflowsDir ?? null;
      if (this.workflowsDir) {
        const workflowDir = join(this.workflowsDir, this.profile.workflow);
        this.workflowConfig = loadWorkflow(workflowDir);
      }
    }
  }

  async start(inputPath: string, opts?: { domain?: string; deliberationDir?: string }): Promise<void> {
    const validation = validateBrief(inputPath, this.profile.input.required_sections);
    if (!validation.valid) {
      const missing = validation.missing.map((s) => s.heading).join(", ");
      throw new Error(`Invalid brief: missing sections: ${missing}`);
    }

    this.startTime = Date.now();

    this.transcript.push({
      type: "session_start",
      timestamp: new Date(this.startTime).toISOString(),
      session_id: this.sessionId,
      profile: this.profile.id,
      domain: opts?.domain || this.domainId || null,
      participants: [...this.agents.keys()],
      constraints: this.profile.constraints,
      auth_mode: this.adapter.getAuthMode(),
      brief_path: inputPath,
    });

    // Workflow mode: create artifacts directory and run workflow
    if (this.workflowMode && this.workflowConfig) {
      const deliberationDir = opts?.deliberationDir ?? join(process.cwd(), ".aos", this.sessionId);
      const artifactsDir = join(deliberationDir, "artifacts");
      mkdirSync(artifactsDir, { recursive: true });

      const runner = new WorkflowRunner(this.workflowConfig, this.adapter, {
        sessionDir: deliberationDir,
        onTranscriptEvent: (e) => this.pushTranscript(e),
      });

      const results = await runner.execute();
      this.workflowResults = results;

      // Render execution package if profile output format requests it
      if (this.profile.output.format === "execution-package") {
        const elapsedMinutes = (Date.now() - this.startTime) / 60000;

        // Collect artifacts from the workflow runner's results
        const artifacts = new Map<string, { manifest: ArtifactManifest; content: string }>();
        for (const [stepId, output] of results) {
          const content = typeof output === "string" ? output : JSON.stringify(output, null, 2);
          artifacts.set(stepId, {
            manifest: {
              schema: "aos/artifact/v1",
              id: stepId,
              produced_by: [],
              step_id: stepId,
              format: "markdown",
              content_path: "",
              metadata: {
                produced_at: new Date().toISOString(),
                review_status: "pending",
                review_gate: null,
                word_count: content.split(/\s+/).filter(Boolean).length,
                revision: 1,
              },
            },
            content,
          });
        }

        const completedSteps = [...results.keys()];
        const gatesPassed = this.transcript
          .filter((e) => e.type === "gate_result" && e.result === "approved")
          .map((e) => e.gate_id as string);

        const rendered = renderExecutionPackage({
          profile: this.profile.id,
          workflow: this.workflowConfig!.id,
          sessionId: this.sessionId,
          domain: this.domainId,
          participants: [...this.agents.keys()],
          briefPath: inputPath,
          transcriptPath: join(deliberationDir, "transcript.yaml"),
          durationMinutes: Math.round(elapsedMinutes * 100) / 100,
          stepsCompleted: completedSteps,
          gatesPassed,
          artifacts,
          sections: this.profile.output.sections,
        });

        const outputPath = this.profile.output.path_template
          .replace("{{session_id}}", this.sessionId)
          .replace("{{date}}", new Date().toISOString().slice(0, 10))
          .replace("{{brief_slug}}", inputPath.split("/").pop()?.replace(/\.\w+$/, "") ?? "brief");

        await this.adapter.writeFile(outputPath, rendered);
        this.adapter.notify(`Execution package written to ${outputPath}`, "info");
      }
    }
  }

  /** Results from a completed workflow run, if in workflow mode. */
  private workflowResults: Map<string, unknown> | null = null;

  /** Get the workflow results (only populated after workflow mode completes). */
  getWorkflowResults(): Map<string, unknown> | null {
    return this.workflowResults;
  }

  /** Check if the engine is running in workflow mode. */
  isWorkflowMode(): boolean {
    return this.workflowMode;
  }

  async delegateMessage(to: string | string[] | "all", message: string): Promise<AgentResponse[]> {
    this.roundNumber += 1;

    // Resource exhaustion protection (M5 from security audit)
    const maxParallelAgents = 15;
    const allPerspectives = this.profile.assembly.perspectives;
    if (allPerspectives.length > maxParallelAgents) {
      throw new Error(`Too many parallel agents (${allPerspectives.length}). Maximum is ${maxParallelAgents}.`);
    }

    // Parse target
    let target: DelegationTarget;
    if (to === "all") {
      target = { type: "broadcast" };
    } else if (Array.isArray(to)) {
      target = { type: "targeted", agents: to };
    } else {
      target = { type: "targeted", agents: [to] };
    }

    // Resolve routing
    const routing = this.delegationRouter.resolve(target, this.roundNumber);

    if (routing.blocked) {
      throw new Error(
        `Delegation blocked by bias limit. Neglected agents: ${routing.neglected.join(", ")}`,
      );
    }

    // Pre-round budget estimation (spec Section 6.7)
    const agentCount = routing.parallel.length + routing.sequential.length;
    const modelCost = this.adapter.getModelCost("standard");
    const estimatedTokens = this.profile.budget_estimation?.fixed_estimate_tokens ?? 2000;
    const safetyMargin = this.profile.budget_estimation?.safety_margin ?? 0.15;
    const estimatedCost = this.constraintEngine.estimateRoundCost(agentCount, estimatedTokens, modelCost);
    const headroom = this.constraintEngine.checkBudgetHeadroom(estimatedCost, safetyMargin);

    if (headroom < 0 && isFinite(headroom)) {
      // Drop optional agents first
      const requiredOnly = routing.parallel.filter((id) => {
        const member = this.profile.assembly.perspectives.find((p) => p.agent === id);
        return member?.required ?? false;
      });
      if (requiredOnly.length < routing.parallel.length) {
        routing.parallel = requiredOnly;
        this.transcript.push({
          type: "budget_estimate",
          timestamp: new Date().toISOString(),
          round: this.roundNumber,
          estimatedCost,
          headroom,
          action: "drop_optional",
          droppedCount: agentCount - requiredOnly.length - routing.sequential.length,
        });
      }
    }

    // Ensure agent handles exist
    const allAgents = [...routing.parallel, ...routing.sequential];
    for (const agentId of allAgents) {
      if (!this.handles.has(agentId)) {
        const config = this.agents.get(agentId);
        if (!config) {
          throw new Error(`Unknown agent: ${agentId}`);
        }
        const handle = await this.adapter.spawnAgent(config, this.sessionId);
        this.handles.set(agentId, handle);

        this.transcript.push({
          type: "agent_spawn",
          timestamp: new Date().toISOString(),
          agentId,
        });
      }
    }

    // Record delegation in transcript
    this.transcript.push({
      type: "delegation",
      timestamp: new Date().toISOString(),
      round: this.roundNumber,
      target: to,
      message,
      parallel: routing.parallel,
      sequential: routing.sequential,
    });

    const responses: AgentResponse[] = [];

    // Read error_handling config from profile (spec Section 6.5)
    const errorHandling = this.profile.error_handling;
    const failureAction = errorHandling?.on_agent_failure ?? "skip";

    // Dispatch parallel agents
    if (routing.parallel.length > 0) {
      const parallelHandles = routing.parallel.map((id) => this.handles.get(id)!);
      const parallelResponses = await this.adapter.dispatchParallel(parallelHandles, message);

      for (let i = 0; i < routing.parallel.length; i++) {
        const resp = parallelResponses[i];

        // Handle agent failure per error_handling config
        if (resp.status === "failed") {
          this.transcript.push({
            type: "error",
            timestamp: new Date().toISOString(),
            agentId: routing.parallel[i],
            round: this.roundNumber,
            error: resp.error || "Agent failed",
          });

          if (failureAction === "abort_round") {
            throw new Error(`Agent ${routing.parallel[i]} failed: ${resp.error}. Aborting round.`);
          }
          if (failureAction === "abort_session") {
            throw new Error(`Agent ${routing.parallel[i]} failed: ${resp.error}. Aborting session.`);
          }
          // "skip": include failed response with status, continue
        }

        responses.push(resp);
        this.transcript.push({
          type: "response",
          timestamp: new Date().toISOString(),
          agentId: routing.parallel[i],
          round: this.roundNumber,
          text: resp.text,
          cost: resp.cost,
          status: resp.status,
        });
      }
    }

    // Dispatch sequential agents (speaks-last)
    for (const agentId of routing.sequential) {
      const handle = this.handles.get(agentId)!;
      const response = await this.adapter.sendMessage(handle, message);

      // Handle agent failure per error_handling config
      if (response.status === "failed") {
        this.transcript.push({
          type: "error",
          timestamp: new Date().toISOString(),
          agentId,
          round: this.roundNumber,
          error: response.error || "Agent failed",
        });

        if (failureAction === "abort_round") {
          throw new Error(`Agent ${agentId} failed: ${response.error}. Aborting round.`);
        }
        if (failureAction === "abort_session") {
          throw new Error(`Agent ${agentId} failed: ${response.error}. Aborting session.`);
        }
        // "skip": include failed response with status, continue
      }

      responses.push(response);
      this.transcript.push({
        type: "response",
        timestamp: new Date().toISOString(),
        agentId,
        round: this.roundNumber,
        text: response.text,
        cost: response.cost,
        status: response.status,
      });
    }

    // Calculate round cost and elapsed time
    const roundCost = responses.reduce((sum, r) => sum + r.cost, 0);
    const elapsedMinutes = this.startTime > 0
      ? (Date.now() - this.startTime) / 60000
      : 0;

    this.constraintEngine.recordRound(roundCost, elapsedMinutes);

    // Update bias in constraint engine
    const biasState = this.delegationRouter.getBiasState();
    this.constraintEngine.updateBias(
      biasState.ratio,
      biasState.most_addressed,
      biasState.least_addressed,
      biasState.blocked,
    );

    // Emit constraint_check after every round (spec Section 6.10)
    const constraintState = this.constraintEngine.getState();
    this.transcript.push({
      type: "constraint_check",
      timestamp: new Date().toISOString(),
      round: this.roundNumber,
      state: constraintState,
    });

    // Emit constraint_warning when approaching maximums (80%+)
    if (constraintState.approaching_any_maximum) {
      this.transcript.push({
        type: "constraint_warning",
        timestamp: new Date().toISOString(),
        round: this.roundNumber,
        approaching_max_time: constraintState.approaching_max_time,
        approaching_max_budget: constraintState.approaching_max_budget,
        approaching_max_rounds: constraintState.approaching_max_rounds,
      });
    }

    return responses;
  }

  async end(closingMessage: string): Promise<AgentResponse[]> {
    const state = this.constraintEngine.getState();
    if (!state.can_end) {
      throw new Error(
        "Cannot end session: minimums not met and no maximum hit",
      );
    }

    // Emit end_session before the final broadcast (spec Section 6.10)
    this.transcript.push({
      type: "end_session",
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      closingMessage,
    });

    // Route as broadcast (speaks-last gets final turn)
    const responses = await this.delegateMessage("all", closingMessage);

    // Tag final statements (replace the generic "response" entries just added)
    // The delegateMessage call above added "response" entries; re-tag the last N as final_statement
    const finalCount = responses.length;
    const transcriptLen = this.transcript.length;
    for (let i = transcriptLen - 1, tagged = 0; i >= 0 && tagged < finalCount; i--) {
      if (this.transcript[i].type === "response") {
        this.transcript[i].type = "final_statement";
        tagged++;
      }
    }

    this.transcript.push({
      type: "session_end",
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      roundsCompleted: this.roundNumber,
    });

    return responses;
  }

  private generateSessionId(): string {
    return randomUUID().slice(0, 12);
  }

  getConstraintState(): ConstraintState {
    const state = this.constraintEngine.getState();

    // Update bias from delegation router
    const biasState = this.delegationRouter.getBiasState();
    state.bias_ratio = biasState.ratio;
    state.most_addressed = biasState.most_addressed;
    state.least_addressed = biasState.least_addressed;
    state.bias_blocked = biasState.blocked;

    return state;
  }

  getTranscript(): TranscriptEntry[] {
    return [...this.transcript];
  }

  /** Push an external transcript entry (e.g., steer events from the adapter). */
  pushTranscript(entry: TranscriptEntry): void {
    this.transcript.push(entry);
  }
}
