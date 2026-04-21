/**
 * Config Loader — loads and validates YAML config files.
 * Uses js-yaml for parsing.
 * See spec Sections 3.1, 4.1, 5.1 for schemas.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { AgentConfig, ProfileConfig, DomainConfig, InputSection, SkillConfig } from "./types";
import type { WorkflowConfig } from "./workflow-runner";
import { parseToolsBlock } from "./profile-schema";

export class ConfigError extends Error {
  constructor(message: string, public path: string) {
    super(`Config error in ${path}: ${message}`);
    this.name = "ConfigError";
  }
}

function validateId(id: string, path: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new ConfigError(`Invalid ID "${id}" — must be lowercase alphanumeric with hyphens`, path);
  }
}

export function loadAgent(agentDir: string): AgentConfig {
  const yamlPath = join(agentDir, "agent.yaml");
  const promptPath = join(agentDir, "prompt.md");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("agent.yaml not found", agentDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as AgentConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("agent.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/agent/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/agent/v1"`,
      yamlPath,
    );
  }

  const required = ["id", "name", "role", "cognition", "persona", "model"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }

  validateId(config.id, yamlPath);

  if (existsSync(promptPath)) {
    config.systemPrompt = readFileSync(promptPath, "utf-8");
  }

  config.tensions = config.tensions || [];
  config.tools = config.tools ?? null;
  config.skills = config.skills || [];
  config.expertise = config.expertise || [];

  return config;
}

export function loadProfile(profileDir: string): ProfileConfig {
  const yamlPath = join(profileDir, "profile.yaml");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("profile.yaml not found", profileDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as ProfileConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("profile.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/profile/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/profile/v1"`,
      yamlPath,
    );
  }

  const required = ["id", "name", "assembly", "constraints", "input", "output"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }

  validateId(config.id, yamlPath);

  // Expertise concurrency warning (spec Section 6.9)
  if (config.expertise?.mode === "shared") {
    console.warn(
      "WARNING: Profile uses shared expertise mode. Concurrent agent writes may conflict during parallel dispatch.",
    );
  }

  // Parse optional workflow field
  config.workflow = config.workflow ?? null;
  config.runtime_requirements = {
    serve: config.runtime_requirements?.serve ?? false,
    channels: config.runtime_requirements?.channels ?? false,
    mempalace: config.runtime_requirements?.mempalace ?? false,
  };

  // Parse optional tools block (spec D3.1). Malformed → throw (caller surfaces as exit 3).
  try {
    config.tools = parseToolsBlock((config as any).tools);
  } catch (e) {
    throw new ConfigError((e as Error).message, yamlPath);
  }

  // Ensure role_override is preserved on perspective entries
  if (config.assembly?.perspectives) {
    for (const p of config.assembly.perspectives) {
      p.role_override = p.role_override ?? null;
    }
  }

  return config;
}

export function loadDomain(domainDir: string): DomainConfig {
  const yamlPath = join(domainDir, "domain.yaml");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("domain.yaml not found", domainDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as DomainConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("domain.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/domain/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/domain/v1"`,
      yamlPath,
    );
  }

  if (config.id) {
    validateId(config.id, yamlPath);
  }

  config.overlays = config.overlays || {};
  config.additional_input_sections = config.additional_input_sections || [];
  config.additional_output_sections = config.additional_output_sections || [];
  config.guardrails = config.guardrails || [];

  return config;
}

export interface BriefValidation {
  valid: boolean;
  content: string;
  missing: InputSection[];
}

export function loadWorkflow(workflowDir: string): WorkflowConfig {
  // Support both a directory containing workflow.yaml and a direct yaml file path
  let yamlPath: string;
  if (workflowDir.endsWith(".yaml") || workflowDir.endsWith(".yml")) {
    yamlPath = workflowDir;
  } else {
    yamlPath = join(workflowDir, "workflow.yaml");
  }

  if (!existsSync(yamlPath)) {
    throw new ConfigError("workflow.yaml not found", workflowDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as WorkflowConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("workflow.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/workflow/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/workflow/v1"`,
      yamlPath,
    );
  }

  // description and gates are optional; provide defaults
  config.description = config.description || "";
  config.gates = config.gates || [];

  const required = ["id", "name", "steps"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }

  if (!Array.isArray(config.steps) || config.steps.length === 0) {
    throw new ConfigError("Workflow must have at least one step", yamlPath);
  }

  // Apply defaults for optional step fields
  for (const step of config.steps) {
    step.input = step.input || [];
    step.review_gate = step.review_gate ?? false;
  }

  // Validate tension-pair steps have exactly 2 agents
  for (const step of config.steps) {
    if (step.action === "tension-pair") {
      if (!step.agents || step.agents.length !== 2) {
        throw new ConfigError(
          `Step "${step.id}" with action "tension-pair" must have exactly 2 agents`,
          yamlPath,
        );
      }
    }
  }

  // Validate artifact ID (output) uniqueness
  const outputIds = new Set<string>();
  for (const step of config.steps) {
    if (step.output) {
      if (outputIds.has(step.output)) {
        throw new ConfigError(
          `Duplicate artifact output ID "${step.output}" found in step "${step.id}"`,
          yamlPath,
        );
      }
      outputIds.add(step.output);
    }
  }

  // Validate step references in gates
  const stepIds = new Set(config.steps.map((s) => s.id));
  for (const gate of config.gates) {
    if (!stepIds.has(gate.after)) {
      throw new ConfigError(
        `Gate references unknown step "${gate.after}"`,
        yamlPath,
      );
    }
    // Validate gate references a step with review_gate: true
    const targetStep = config.steps.find((s) => s.id === gate.after);
    if (targetStep && !targetStep.review_gate) {
      throw new ConfigError(
        `Gate after "${gate.after}" references a step without review_gate: true`,
        yamlPath,
      );
    }
  }

  // Validate step input references using dual resolution:
  // 1. Check output IDs first (only from preceding steps — no forward references)
  // 2. Fall back to step IDs of preceding steps (backward compatibility)
  const precedingOutputIds = new Set<string>();
  const precedingStepIds = new Set<string>();
  for (const step of config.steps) {
    for (const inputRef of step.input!) {
      if (precedingOutputIds.has(inputRef)) {
        // Resolved as an artifact output ID from a preceding step
        continue;
      }
      if (precedingStepIds.has(inputRef)) {
        // Backward-compatible: resolved as a preceding step ID
        continue;
      }
      // Check if the reference exists at all (for a better error message)
      if (outputIds.has(inputRef) || stepIds.has(inputRef)) {
        throw new ConfigError(
          `Step "${step.id}" has forward reference to "${inputRef}" which is defined in a later step`,
          yamlPath,
        );
      }
      throw new ConfigError(
        `Step "${step.id}" references unknown input "${inputRef}"`,
        yamlPath,
      );
    }
    // After validating this step's inputs, add its outputs/id to the preceding sets
    precedingStepIds.add(step.id);
    if (step.output) {
      precedingOutputIds.add(step.output);
    }
  }

  return config;
}

export function loadSkill(skillDir: string): SkillConfig {
  const yamlPath = join(skillDir, "skill.yaml");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("skill.yaml not found", skillDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as SkillConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("skill.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/skill/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/skill/v1"`,
      yamlPath,
    );
  }

  const required = ["id", "name", "description", "version", "input", "output"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }

  validateId(config.id, yamlPath);

  // Apply defaults
  config.input.required = config.input.required || [];
  config.input.optional = config.input.optional || [];
  config.output.artifacts = config.output.artifacts || [];
  config.output.structured_result = config.output.structured_result ?? false;
  config.compatible_agents = config.compatible_agents || [];
  config.platform_bindings = config.platform_bindings || {};
  config.platform_requirements = config.platform_requirements || {};

  return config;
}

export function validateBrief(
  briefPath: string,
  requiredSections: InputSection[],
): BriefValidation {
  if (!existsSync(briefPath)) {
    throw new ConfigError("Brief file not found", briefPath);
  }

  const content = readFileSync(briefPath, "utf-8");
  const contentLower = content.toLowerCase();

  const missing = requiredSections.filter(
    (s) => !contentLower.includes(s.heading.toLowerCase()),
  );

  return { valid: missing.length === 0, content, missing };
}
