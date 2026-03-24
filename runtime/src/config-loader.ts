/**
 * Config Loader — loads and validates YAML config files.
 * Uses js-yaml for parsing.
 * See spec Sections 3.1, 4.1, 5.1 for schemas.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { AgentConfig, ProfileConfig, DomainConfig, InputSection } from "./types";
import type { WorkflowConfig } from "./workflow-runner";

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

  const required = ["id", "name", "description", "steps", "gates"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }

  if (!Array.isArray(config.steps) || config.steps.length === 0) {
    throw new ConfigError("Workflow must have at least one step", yamlPath);
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
  }

  // Validate step input references
  for (const step of config.steps) {
    step.input = step.input || [];
    for (const inputId of step.input) {
      if (!stepIds.has(inputId)) {
        throw new ConfigError(
          `Step "${step.id}" references unknown input step "${inputId}"`,
          yamlPath,
        );
      }
    }
  }

  config.gates = config.gates || [];

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
