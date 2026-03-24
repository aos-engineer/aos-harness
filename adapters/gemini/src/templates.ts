/**
 * Template helpers for Gemini CLI adapter output formatting.
 * Generates .gemini/-compatible agent definitions, settings,
 * and GEMINI.md fragments from AOS core config.
 */

import type { AgentConfig, ProfileConfig, ModelTier } from "../../../runtime/src/types";

// -- Model tier mapping -------------------------------------------------------

const TIER_TO_MODEL: Record<ModelTier, string> = {
  economy: "gemini-2.0-flash",
  standard: "gemini-2.5-pro",
  premium: "gemini-2.5-pro",
};

export function mapTierToModel(tier: ModelTier): string {
  return TIER_TO_MODEL[tier] ?? "gemini-2.5-pro";
}

// -- Agent file generation ----------------------------------------------------

export function generateAgentFile(
  agent: AgentConfig,
  profile: ProfileConfig,
  allAgentNames: string[],
): string {
  const modelName = mapTierToModel(agent.model.tier);
  const description = `${agent.role.split(".")[0]}.`;

  // Build YAML frontmatter
  const frontmatter = [
    "---",
    `name: AOS ${agent.name}`,
    `description: ${description}`,
    `model: ${modelName}`,
    "---",
  ].join("\n");

  // Resolve template variables in the prompt
  const resolvedPrompt = resolveAgentPrompt(agent, profile, allAgentNames);

  // Cognitive framework section
  const cognitiveFramework = formatCognitiveFramework(agent);

  // Heuristics section
  const heuristics = formatHeuristics(agent);

  return `${frontmatter}

# ${agent.name} — ${agent.cognition.core_bias.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} Lens

${resolvedPrompt}

## Cognitive Framework
- **Objective:** ${agent.cognition.objective_function}
- **Core Bias:** ${agent.cognition.core_bias}
- **Risk Tolerance:** ${agent.cognition.risk_tolerance}
- **Time Horizon:** ${agent.cognition.time_horizon.primary}

## Heuristics
${heuristics}
`;
}

// -- Prompt variable resolution -----------------------------------------------

function resolveAgentPrompt(
  agent: AgentConfig,
  profile: ProfileConfig,
  allAgentNames: string[],
): string {
  const prompt = agent.systemPrompt ?? "";

  const constraintSummary = formatConstraintSummary(profile);
  const expertiseBlock = formatExpertiseBlock(agent);
  const participants = allAgentNames.join(", ");

  const variables: Record<string, string> = {
    agent_name: agent.name,
    agent_id: agent.id,
    session_id: "(provided at runtime)",
    participants,
    constraints: constraintSummary,
    brief: "(provided by the user)",
    expertise_block: expertiseBlock,
    deliberation_dir: "(working directory)",
    transcript_path: "(not available in Gemini CLI mode)",
  };

  let resolved = prompt;
  for (const [key, value] of Object.entries(variables)) {
    resolved = resolved.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return resolved;
}

// -- Settings file generation -------------------------------------------------

export function generateSettingsFile(
  profile: ProfileConfig,
  agents: AgentConfig[],
): string {
  const agentSettings: Record<string, { model: string }> = {};

  for (const agent of agents) {
    agentSettings[`aos-${agent.id}`] = {
      model: mapTierToModel(agent.model.tier),
    };
  }

  return JSON.stringify({ agents: agentSettings }, null, 2) + "\n";
}

// -- GEMINI.md fragment generation --------------------------------------------

export function generateGeminiMdFragment(
  profile: ProfileConfig,
  agents: AgentConfig[],
): string {
  const agentRows = agents
    .map((a) => `| ${a.name} | ${a.role.split(".")[0]} | ${mapTierToModel(a.model.tier)} |`)
    .join("\n");

  const constraintSummary = formatConstraintSummary(profile);

  return `## AOS Framework — Agentic Orchestration

This project uses the AOS Framework for multi-perspective strategic deliberation.

### Agent Roster
| Agent | Role | Model |
|---|---|---|
${agentRows}

### How It Works
The Arbiter (orchestrator) dispatches specialist agents for deliberation. Each agent has a distinct cognitive bias and evaluates your brief from their unique perspective. The Arbiter synthesizes all perspectives into a ranked recommendation memo.

### Constraints
These are advisory — Gemini CLI does not enforce them at runtime:
${constraintSummary}
`;
}

// -- Shared formatting helpers ------------------------------------------------

function formatConstraintSummary(profile: ProfileConfig): string {
  const c = profile.constraints;
  const lines: string[] = [];

  lines.push(`- Time: ${c.time.min_minutes}-${c.time.max_minutes} minutes`);

  if (c.budget) {
    lines.push(
      `- Budget: $${c.budget.min}-$${c.budget.max} ${c.budget.currency}`,
    );
  }

  lines.push(`- Rounds: ${c.rounds.min}-${c.rounds.max} exchanges`);

  return lines.join("\n");
}

function formatExpertiseBlock(agent: AgentConfig): string {
  if (!agent.expertise || agent.expertise.length === 0) {
    return "(no expertise files configured)";
  }

  return agent.expertise
    .map((e) => `- ${e.path} (${e.mode}) — ${e.use_when}`)
    .join("\n");
}

function formatCognitiveFramework(agent: AgentConfig): string {
  const c = agent.cognition;
  return [
    `- **Objective:** ${c.objective_function}`,
    `- **Core Bias:** ${c.core_bias}`,
    `- **Risk Tolerance:** ${c.risk_tolerance}`,
    `- **Time Horizon:** ${c.time_horizon.primary}`,
  ].join("\n");
}

function formatHeuristics(agent: AgentConfig): string {
  if (!agent.persona.heuristics || agent.persona.heuristics.length === 0) {
    return "(no heuristics configured)";
  }

  return agent.persona.heuristics
    .map((h) => `- **${h.name}:** ${h.rule}`)
    .join("\n");
}
