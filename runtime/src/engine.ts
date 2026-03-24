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
import type {
  AOSAdapter,
  AgentConfig,
  AgentHandle,
  AgentResponse,
  ConstraintState,
  TranscriptEntry,
} from "./types";
import { loadProfile, loadAgent, loadDomain, validateBrief } from "./config-loader";
import { ConstraintEngine } from "./constraint-engine";
import { DelegationRouter } from "./delegation-router";
import type { DelegationTarget } from "./delegation-router";
import { applyDomain } from "./domain-merger";

export interface EngineOpts {
  agentsDir: string;
  domain?: string;
  domainDir?: string;
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

  constructor(adapter: AOSAdapter, profilePath: string, opts: EngineOpts) {
    this.adapter = adapter;
    this.sessionId = `session-${Date.now()}`;

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
  }

  async start(inputPath: string): Promise<void> {
    const validation = validateBrief(inputPath, this.profile.input.required_sections);
    if (!validation.valid) {
      const missing = validation.missing.map((s) => s.heading).join(", ");
      throw new Error(`Invalid brief: missing sections: ${missing}`);
    }

    this.startTime = Date.now();

    this.transcript.push({
      type: "session_start",
      timestamp: new Date(this.startTime).toISOString(),
      sessionId: this.sessionId,
      briefPath: inputPath,
    });
  }

  async delegateMessage(to: string | string[] | "all", message: string): Promise<AgentResponse[]> {
    this.roundNumber += 1;

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

    // Dispatch parallel agents
    if (routing.parallel.length > 0) {
      const parallelHandles = routing.parallel.map((id) => this.handles.get(id)!);
      const parallelResponses = await this.adapter.dispatchParallel(parallelHandles, message);

      for (let i = 0; i < routing.parallel.length; i++) {
        responses.push(parallelResponses[i]);
        this.transcript.push({
          type: "response",
          timestamp: new Date().toISOString(),
          agentId: routing.parallel[i],
          round: this.roundNumber,
          text: parallelResponses[i].text,
          cost: parallelResponses[i].cost,
        });
      }
    }

    // Dispatch sequential agents (speaks-last)
    for (const agentId of routing.sequential) {
      const handle = this.handles.get(agentId)!;
      const response = await this.adapter.sendMessage(handle, message);
      responses.push(response);
      this.transcript.push({
        type: "response",
        timestamp: new Date().toISOString(),
        agentId,
        round: this.roundNumber,
        text: response.text,
        cost: response.cost,
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
}
