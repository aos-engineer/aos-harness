// ── AOS Framework Runtime Types ─────────────────────────────────

// ── Auth & Cost ─────────────────────────────────────────────────

export interface AuthMode {
  type: "api_key" | "subscription" | "unknown";
  subscription_tier?: string;
  metered: boolean;
}

export interface ModelCost {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
  currency: string;
}

export type ModelTier = "economy" | "standard" | "premium";
export type ThinkingMode = "off" | "on" | "extended";
export type RiskTolerance = "very-low" | "low" | "moderate" | "high" | "very-high";
export type FailureAction = "skip" | "abort_round" | "abort_session";
export type BudgetExceededAction = "drop_optional" | "warn_arbiter" | "block_round";

// ── Agent Config ────────────────────────────────────────────────

export interface AgentCognition {
  objective_function: string;
  time_horizon: {
    primary: string;
    secondary: string;
    peripheral: string;
  };
  core_bias: string;
  risk_tolerance: RiskTolerance;
  default_stance: string;
}

export interface Heuristic {
  name: string;
  rule: string;
}

export interface AgentPersona {
  temperament: string[];
  thinking_patterns: string[];
  heuristics: Heuristic[];
  evidence_standard: {
    convinced_by: string[];
    not_convinced_by: string[];
  };
  red_lines: string[];
}

export interface TensionPair {
  agent: string;
  dynamic: string;
}

export interface ExpertiseEntry {
  path: string;
  mode: "read-only" | "read-write";
  use_when: string;
}

export interface AgentCapabilities {
  can_execute_code: boolean;
  can_produce_files: boolean;
  can_review_artifacts: boolean;
  available_skills: string[];
  output_types: ("text" | "markdown" | "code" | "diagram" | "structured-data")[];
}

export interface AgentConfig {
  schema: string;
  id: string;
  name: string;
  role: string;
  cognition: AgentCognition;
  persona: AgentPersona;
  tensions: TensionPair[];
  report: { structure: string };
  tools: string[] | null;
  skills: string[];
  expertise: ExpertiseEntry[];
  model: { tier: ModelTier; thinking: ThinkingMode };
  systemPrompt?: string;
  capabilities?: AgentCapabilities;
}

// ── Profile Config ──────────────────────────────────────────────

export interface AssemblyMember {
  agent: string;
  required: boolean;
  structural_advantage?: "speaks-last";
  role_override?: string | null;
}

export interface ProfileConstraints {
  time: { min_minutes: number; max_minutes: number };
  budget: { min: number; max: number; currency: string } | null;
  rounds: { min: number; max: number };
}

export interface ErrorHandling {
  agent_timeout_seconds: number;
  retry_policy: { max_retries: number; backoff: "exponential" | "linear" };
  on_agent_failure: FailureAction;
  on_orchestrator_failure: "save_transcript_and_exit";
  partial_results: "include_with_status_flag";
}

export interface BudgetEstimation {
  strategy: "rolling_average" | "fixed_estimate";
  fixed_estimate_tokens: number;
  safety_margin: number;
  on_estimate_exceeded: BudgetExceededAction;
}

export interface InputSection {
  heading: string;
  guidance: string;
}

export interface ProfileConfig {
  schema: string;
  id: string;
  name: string;
  description: string;
  version: string;
  assembly: {
    orchestrator: string;
    perspectives: AssemblyMember[];
  };
  delegation: {
    default: "broadcast" | "round-robin" | "targeted";
    opening_rounds: number;
    tension_pairs: [string, string][];
    bias_limit: number;
  };
  constraints: ProfileConstraints;
  error_handling: ErrorHandling;
  budget_estimation: BudgetEstimation;
  input: {
    format: "brief" | "question" | "document" | "freeform";
    required_sections: InputSection[];
    context_files: boolean;
  };
  output: {
    format: string;
    path_template: string;
    sections: string[];
    artifacts: { type: string }[];
    frontmatter: string[];
  };
  expertise: {
    enabled: boolean;
    path_template: string;
    mode: "per-agent" | "shared" | "none";
  };
  controls: {
    halt: boolean;
    wrap: boolean;
    interject: boolean;
  };
  workflow?: string | null;
}

// ── Domain Config ───────────────────────────────────────────────

export interface DomainOverlay {
  thinking_patterns?: string[];
  heuristics?: Heuristic[];
  red_lines?: string[];
  evidence_standard?: {
    convinced_by?: string[];
    not_convinced_by?: string[];
  };
  temperament?: string[];
}

export interface DomainConfig {
  schema: string;
  id: string;
  name: string;
  description: string;
  lexicon: {
    metrics: string[];
    frameworks: string[];
    stages: string[];
  };
  overlays: Record<string, DomainOverlay>;
  additional_input_sections: InputSection[];
  additional_output_sections: { section: string; description: string }[];
  guardrails: string[];
}

// ── Constraint State ────────────────────────────────────────────

export interface ConstraintState {
  elapsed_minutes: number;
  budget_spent: number;
  rounds_completed: number;
  past_min_time: boolean;
  past_min_budget: boolean;
  past_min_rounds: boolean;
  past_all_minimums: boolean;
  approaching_max_time: boolean;
  approaching_max_budget: boolean;
  approaching_max_rounds: boolean;
  approaching_any_maximum: boolean;
  hit_maximum: boolean;
  hit_reason: "none" | "time" | "budget" | "rounds" | "constraint_conflict";
  conflict_detail?: string;
  can_end: boolean;
  bias_ratio: number;
  most_addressed: string[];
  least_addressed: string[];
  bias_blocked: boolean;
  metered: boolean;
}

// ── Agent Runtime Types ─────────────────────────────────────────

export interface AgentHandle {
  id: string;
  agentId: string;
  sessionId: string;
}

export interface MessageOpts {
  contextFiles?: string[];
  signal?: AbortSignal;
  onStream?: (partial: string) => void;
}

export interface AgentResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  contextTokens: number;
  model: string;
  status: "success" | "failed" | "aborted";
  error?: string;
}

export interface ContextUsage {
  tokens: number;
  percent: number;
}

// ── Delegation ──────────────────────────────────────────────────

export type DelegationTarget =
  | { type: "broadcast" }
  | { type: "targeted"; agents: string[] }
  | { type: "tension"; pair: [string, string] };

// ── Artifact Types ──────────────────────────────────────────────

export interface ArtifactManifest {
  schema: "aos/artifact/v1";
  id: string;
  produced_by: string[];
  step_id: string;
  format: "markdown" | "code" | "structured-data" | "diagram";
  content_path: string;
  metadata: {
    produced_at: string;
    review_status: "pending" | "approved" | "rejected" | "revised";
    review_gate: string | null;
    word_count: number;
    revision: number;
    [key: string]: unknown;
  };
}

export interface LoadedArtifact {
  manifest: ArtifactManifest;
  content: string;
}

// ── Execution Adapter Types ─────────────────────────────────────

export interface ExecuteCodeOpts {
  language?: string;
  timeout_ms?: number;
  cwd?: string;
  env?: Record<string, string>;
  sandbox?: "strict" | "relaxed";
}

export interface ExecutionResult {
  success: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  files_created?: string[];
  files_modified?: string[];
}

export interface SkillInput {
  args?: string;
  context?: Record<string, string>;
  artifacts?: string[];
}

export interface SkillResult {
  success: boolean;
  output: string;
  artifacts_produced?: string[];
  files_created?: string[];
  files_modified?: string[];
  error?: string;
}

export interface ReviewResult {
  status: "approved" | "rejected" | "needs-revision";
  feedback?: string;
  reviewer: string;
  issues?: ReviewIssue[];
}

export interface ReviewIssue {
  severity: "critical" | "major" | "minor" | "suggestion";
  description: string;
  location?: string;
}

export class UnsupportedError extends Error {
  constructor(method: string, message?: string) {
    super(message ?? `Method "${method}" is not supported by this adapter`);
    this.name = "UnsupportedError";
  }
}

// ── Transcript Events ───────────────────────────────────────────

export type TranscriptEventType =
  | "session_start"
  | "agent_spawn"
  | "delegation"
  | "response"
  | "constraint_check"
  | "constraint_warning"
  | "budget_estimate"
  | "budget_abort"
  | "steer"
  | "error"
  | "expertise_write"
  | "end_session"
  | "final_statement"
  | "agent_destroy"
  | "session_end"
  // Workflow events
  | "workflow_start"
  | "step_start"
  | "step_end"
  | "gate_prompt"
  | "gate_result"
  | "artifact_write"
  | "workflow_end"
  // Execution events
  | "code_execution"
  | "skill_invocation"
  | "review_submission";

export interface TranscriptEntry {
  type: TranscriptEventType;
  timestamp: string;
  [key: string]: unknown;
}

// ── Adapter Interface ───────────────────────────────────────────

export interface AgentRuntimeAdapter {
  spawnAgent(config: AgentConfig, sessionId: string): Promise<AgentHandle>;
  sendMessage(handle: AgentHandle, message: string, opts?: MessageOpts): Promise<AgentResponse>;
  destroyAgent(handle: AgentHandle): Promise<void>;
  setOrchestratorPrompt(prompt: string): void;
  injectContext(handle: AgentHandle, files: string[]): Promise<void>;
  getContextUsage(handle: AgentHandle): ContextUsage;
  setModel(handle: AgentHandle, modelConfig: { tier: ModelTier; thinking: ThinkingMode }): void;
  getAuthMode(): AuthMode;
  getModelCost(tier: ModelTier): ModelCost;
  abort(): void;
}

export interface EventBusAdapter {
  onSessionStart(handler: () => Promise<void>): void;
  onSessionShutdown(handler: () => Promise<void>): void;
  onBeforeAgentStart(handler: (prompt: string) => Promise<{ systemPrompt?: string }>): void;
  onAgentEnd(handler: () => Promise<void>): void;
  onToolCall(handler: (toolName: string, input: unknown) => Promise<{ block?: boolean }>): void;
  onToolResult(handler: (toolName: string, input: unknown, result: unknown) => Promise<void>): void;
  onMessageEnd(handler: (usage: { cost: number; tokens: number }) => Promise<void>): void;
  onCompaction(handler: () => Promise<void>): void;
}

export interface UIAdapter {
  registerCommand(name: string, handler: (args: string) => Promise<void>): void;
  registerTool(name: string, schema: Record<string, unknown>, handler: (params: Record<string, unknown>) => Promise<unknown>): void;
  renderAgentResponse(agent: string, response: string, color: string): void;
  renderCustomMessage(type: string, content: string, details: Record<string, unknown>): void;
  setWidget(id: string, renderer: (() => string[]) | undefined): void;
  setFooter(renderer: (width: number) => string[]): void;
  setStatus(key: string, text: string): void;
  setTheme(name: string): void;
  promptSelect(label: string, options: string[]): Promise<number>;
  promptConfirm(title: string, message: string): Promise<boolean>;
  promptInput(label: string): Promise<string>;
  notify(message: string, level: "info" | "warning" | "error"): void;
  blockInput(allowedCommands: string[]): void;
  unblockInput(): void;
  steerMessage(message: string): void;
}

export interface WorkflowAdapter {
  dispatchParallel(agents: AgentHandle[], message: string, opts?: { signal?: AbortSignal; onStream?: (agentId: string, partial: string) => void }): Promise<AgentResponse[]>;
  isolateWorkspace(): Promise<{ path: string; cleanup: () => Promise<void> }>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  openInEditor(path: string, editor: string): Promise<void>;
  persistState(key: string, value: unknown): Promise<void>;
  loadState(key: string): Promise<unknown>;
  executeCode(handle: AgentHandle, code: string, opts?: ExecuteCodeOpts): Promise<ExecutionResult>;
  invokeSkill(handle: AgentHandle, skillId: string, input: SkillInput): Promise<SkillResult>;
  createArtifact(artifact: ArtifactManifest, content: string): Promise<void>;
  loadArtifact(artifactId: string, sessionDir: string): Promise<LoadedArtifact>;
  submitForReview(artifact: LoadedArtifact, reviewer: AgentHandle, reviewPrompt?: string): Promise<ReviewResult>;
}

export type AOSAdapter = AgentRuntimeAdapter & EventBusAdapter & UIAdapter & WorkflowAdapter;

// ── Helper Functions ────────────────────────────────────────────

export function createDefaultConstraintState(): ConstraintState {
  return {
    elapsed_minutes: 0,
    budget_spent: 0,
    rounds_completed: 0,
    past_min_time: false,
    past_min_budget: false,
    past_min_rounds: false,
    past_all_minimums: false,
    approaching_max_time: false,
    approaching_max_budget: false,
    approaching_max_rounds: false,
    approaching_any_maximum: false,
    hit_maximum: false,
    hit_reason: "none",
    can_end: false,
    bias_ratio: 0,
    most_addressed: [],
    least_addressed: [],
    bias_blocked: false,
    metered: true,
  };
}

export function isConstraintConflict(state: ConstraintState): boolean {
  return state.hit_reason === "constraint_conflict";
}

export function isMetered(auth: AuthMode): boolean {
  return auth.metered;
}
