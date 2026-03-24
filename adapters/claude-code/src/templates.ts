/**
 * Template helpers for Claude Code adapter output formatting.
 * Generates .claude/-compatible agent definitions, slash commands,
 * and CLAUDE.md fragments from AOS core config.
 */

import type { AgentConfig, ProfileConfig, ModelTier } from "@aos-framework/runtime/types";

// ── Model tier mapping ──────────────────────────────────────────

const TIER_TO_MODEL: Record<ModelTier, string> = {
  economy: "haiku",
  standard: "sonnet",
  premium: "opus",
};

export function mapTierToModel(tier: ModelTier): string {
  return TIER_TO_MODEL[tier] ?? "sonnet";
}

// ── Agent file generation ───────────────────────────────────────

export function generateAgentFile(
  agent: AgentConfig,
  profile: ProfileConfig,
  allAgentNames: string[],
): string {
  const modelName = mapTierToModel(agent.model.tier);
  const description = `${agent.role} Use when the AOS ${profile.name} profile needs the ${agent.name} perspective.`;

  // Build frontmatter
  const frontmatter = [
    "---",
    `name: aos-${agent.id}`,
    `description: ${description}`,
    `model: ${modelName}`,
    "---",
  ].join("\n");

  // Resolve template variables in the prompt
  const resolvedPrompt = resolveAgentPrompt(agent, profile, allAgentNames);

  return `${frontmatter}\n\n${resolvedPrompt}`;
}

// ── Prompt variable resolution ──────────────────────────────────

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
    transcript_path: "(not available in Claude Code mode)",
  };

  let resolved = prompt;
  for (const [key, value] of Object.entries(variables)) {
    resolved = resolved.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return resolved;
}

// ── Command file generation ─────────────────────────────────────

export function generateCommandFile(
  profile: ProfileConfig,
  agents: AgentConfig[],
): string {
  const agentList = agents
    .map((a) => `- **${a.name}** (aos-${a.id}): ${a.role}`)
    .join("\n");

  const tensionPairs = (profile.delegation.tension_pairs ?? [])
    .map(([a, b]) => `- ${a} <-> ${b}`)
    .join("\n");

  const constraints = profile.constraints;
  const budgetLine = constraints.budget
    ? `- Budget: target $${constraints.budget.min}-$${constraints.budget.max} ${constraints.budget.currency} in API costs`
    : "- Budget: no budget constraints configured";

  const agentDispatchList = agents
    .map(
      (a) =>
        `- **aos-${a.id}** — ${a.name}. ${a.role.split(".")[0]}. Consult when you need the ${a.cognition.core_bias} perspective.`,
    )
    .join("\n");

  return `You are the Arbiter for the AOS ${profile.name} deliberation.

## Profile: ${profile.name}
${profile.description}

## Your Assembly
${agentList}

## Constraints (Advisory — not enforced by code)
- Time: aim for ${constraints.time.min_minutes}-${constraints.time.max_minutes} minutes of deliberation
${budgetLine}
- Rounds: ${constraints.rounds.min}-${constraints.rounds.max} exchanges

## Tension Pairs
${tensionPairs || "- No tension pairs configured"}

## How to Run This Deliberation

1. Read the user's brief carefully
2. Use the Agent tool to dispatch agents:
   - For broadcast: dispatch all agents in parallel with the same framing question
   - For targeted: dispatch specific agents for follow-up
3. After ${constraints.rounds.min}+ rounds of substantive debate, synthesize into a memo

## Agents Available (use Agent tool to dispatch)
${agentDispatchList}

## Output Format
Write a structured memo with:
- Ranked recommendations (top 3)
- Agent stance table
- Dissent and unresolved tensions
- Trade-offs and risks
- Next actions
- Deliberation summary

$1
`;
}

// ── CLAUDE.md fragment generation ───────────────────────────────

export function generateClaudeMdFragment(
  profile: ProfileConfig,
  agents: AgentConfig[],
): string {
  const agentRows = agents
    .map((a) => `| ${a.name} | ${a.role.split(".")[0]} | ${mapTierToModel(a.model.tier)} |`)
    .join("\n");

  const constraintSummary = formatConstraintSummary(profile);

  return `## AOS Framework — Agentic Orchestration

This project uses the AOS Framework for multi-perspective strategic deliberation.

### Available Commands
- \`/aos-${profile.id}\` — Run the ${profile.name} deliberation with your brief

### Agent Roster
| Agent | Role | Model |
|---|---|---|
${agentRows}

### How It Works
The command launches the Arbiter (orchestrator) who dispatches specialist agents via the Agent tool. Each agent has a distinct cognitive bias and evaluates your brief from their unique perspective. The Arbiter synthesizes all perspectives into a ranked recommendation memo.

### Constraints
These are advisory — Claude Code does not enforce them at runtime:
${constraintSummary}
`;
}

// ── Shared formatting helpers ───────────────────────────────────

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
