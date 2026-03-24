/**
 * Config Loader — loads and validates YAML config files.
 * Uses js-yaml for parsing.
 * See spec Sections 3.1, 4.1, 5.1 for schemas.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { AgentConfig, ProfileConfig, DomainConfig, InputSection } from "./types";

export class ConfigError extends Error {
  constructor(message: string, public path: string) {
    super(`Config error in ${path}: ${message}`);
    this.name = "ConfigError";
  }
}

export function loadAgent(agentDir: string): AgentConfig {
  const yamlPath = join(agentDir, "agent.yaml");
  const promptPath = join(agentDir, "prompt.md");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("agent.yaml not found", agentDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw) as AgentConfig;

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
  const config = yaml.load(raw) as ProfileConfig;

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

  return config;
}

export function loadDomain(domainDir: string): DomainConfig {
  const yamlPath = join(domainDir, "domain.yaml");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("domain.yaml not found", domainDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw) as DomainConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("domain.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/domain/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/domain/v1"`,
      yamlPath,
    );
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
