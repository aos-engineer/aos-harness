#!/usr/bin/env bun
/**
 * AOS Framework — Gemini CLI Adapter Generator
 *
 * Reads AOS core config (profiles, agents, optional domain overlay)
 * and produces static .gemini/-compatible artifacts:
 *   - agents/aos-<id>.md     — Agent definition files with YAML frontmatter
 *   - settings.json           — Model tier mappings
 *   - GEMINI-aos.md           — Fragment to append to project GEMINI.md
 *
 * Usage:
 *   bun run src/generate.ts --profile <name> [--domain <name>] [--output .gemini-aos]
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadProfile, loadAgent, loadDomain } from "@aos-framework/runtime/config-loader";
import { applyDomain } from "@aos-framework/runtime/domain-merger";
import type { AgentConfig } from "@aos-framework/runtime/types";
import {
  generateAgentFile,
  generateSettingsFile,
  generateGeminiMdFragment,
} from "./templates";

// -- CLI argument parsing -----------------------------------------------------

interface CliArgs {
  profile: string;
  domain?: string;
  output: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let profile = "";
  let domain: string | undefined;
  let output = ".gemini-aos";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--profile":
        profile = args[++i];
        break;
      case "--domain":
        domain = args[++i];
        break;
      case "--output":
        output = args[++i];
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!profile) {
    console.error("Error: --profile is required");
    printUsage();
    process.exit(1);
  }

  return { profile, domain, output };
}

function printUsage(): void {
  console.log(`
Usage: bun run src/generate.ts --profile <name> [--domain <name>] [--output <dir>]

Arguments:
  --profile <name>   Profile to generate from (e.g., strategic-council)
  --domain <name>    Optional domain overlay (e.g., fintech, saas)
  --output <dir>     Output directory (default: .gemini-aos)
`);
}

// -- Project root discovery ---------------------------------------------------

function findProjectRoot(): string {
  // Walk up from this file's directory to find the root with core/
  let dir = resolve(import.meta.dir, "..", "..", "..");
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "core"))) {
      return dir;
    }
    dir = resolve(dir, "..");
  }
  throw new Error(
    "Could not find AOS project root (looking for core/ directory)",
  );
}

// -- Agent discovery ----------------------------------------------------------

function findAgentDir(agentsRoot: string, agentId: string): string | null {
  // Agents are organized in subdirectories: perspectives/, orchestrators/, operational/
  const categories = readdirSync(agentsRoot);

  for (const category of categories) {
    const categoryPath = join(agentsRoot, category);
    try {
      const agents = readdirSync(categoryPath);
      if (agents.includes(agentId)) {
        return join(categoryPath, agentId);
      }
    } catch {
      // Not a directory, skip
    }
  }

  return null;
}

// -- Main generator -----------------------------------------------------------

function generate(): void {
  const args = parseArgs();
  const root = findProjectRoot();

  console.log(`AOS Gemini CLI Adapter Generator`);
  console.log(`  Project root: ${root}`);
  console.log(`  Profile: ${args.profile}`);
  if (args.domain) console.log(`  Domain: ${args.domain}`);
  console.log(`  Output: ${args.output}`);
  console.log();

  // 1. Load profile
  const profileDir = join(root, "core", "profiles", args.profile);
  if (!existsSync(profileDir)) {
    console.error(`Profile not found: ${profileDir}`);
    console.error(
      `Available profiles: ${readdirSync(join(root, "core", "profiles")).join(", ")}`,
    );
    process.exit(1);
  }
  const profile = loadProfile(profileDir);
  console.log(`Loaded profile: ${profile.name} (${profile.id})`);

  // 2. Collect all agent IDs from the profile assembly
  const agentIds = [
    profile.assembly.orchestrator,
    ...profile.assembly.perspectives.map((p) => p.agent),
  ];

  // 3. Load all agents
  const agentsRoot = join(root, "core", "agents");
  let agents: AgentConfig[] = [];

  for (const agentId of agentIds) {
    const agentDir = findAgentDir(agentsRoot, agentId);
    if (!agentDir) {
      console.warn(`  Warning: agent "${agentId}" not found, skipping`);
      continue;
    }
    const agent = loadAgent(agentDir);
    agents.push(agent);
    console.log(`  Loaded agent: ${agent.name} (${agent.id}, tier: ${agent.model.tier})`);
  }

  // 4. Optionally apply domain overlay
  if (args.domain) {
    const domainDir = join(root, "core", "domains", args.domain);
    if (!existsSync(domainDir)) {
      console.error(`Domain not found: ${domainDir}`);
      console.error(
        `Available domains: ${readdirSync(join(root, "core", "domains")).join(", ")}`,
      );
      process.exit(1);
    }
    const domain = loadDomain(domainDir);
    agents = applyDomain(agents, domain);
    console.log(`  Applied domain overlay: ${domain.name}`);
  }

  // 5. Collect agent names for cross-referencing
  const allAgentNames = agents.map((a) => a.name);

  // 6. Generate output files
  const outputDir = resolve(args.output);
  const geminiDir = join(outputDir, ".gemini");
  const agentsOutDir = join(geminiDir, "agents");

  mkdirSync(agentsOutDir, { recursive: true });

  // 6a. Generate agent files
  let agentCount = 0;
  for (const agent of agents) {
    const content = generateAgentFile(agent, profile, allAgentNames);
    const filePath = join(agentsOutDir, `aos-${agent.id}.md`);
    writeFileSync(filePath, content);
    agentCount++;
    console.log(`  Generated: .gemini/agents/aos-${agent.id}.md`);
  }

  // 6b. Generate settings.json
  const settingsContent = generateSettingsFile(profile, agents);
  const settingsPath = join(geminiDir, "settings.json");
  writeFileSync(settingsPath, settingsContent);
  console.log(`  Generated: .gemini/settings.json`);

  // 6c. Generate GEMINI.md fragment
  const geminiFragment = generateGeminiMdFragment(profile, agents);
  const geminiMdPath = join(outputDir, "GEMINI-aos.md");
  writeFileSync(geminiMdPath, geminiFragment);
  console.log(`  Generated: GEMINI-aos.md`);

  // Summary
  console.log();
  console.log(`Done! Generated ${agentCount} agent files, 1 settings.json, 1 GEMINI-aos.md fragment`);
  console.log();
  console.log(`To use these artifacts:`);
  console.log(`  1. Copy ${geminiDir}/* to your project's .gemini/`);
  console.log(`  2. Append ${geminiMdPath} to your project's GEMINI.md`);
  console.log();
  console.log(`Or copy the entire output directory:`);
  console.log(`  cp -r ${geminiDir}/ .gemini/`);
  console.log(`  cat ${outputDir}/GEMINI-aos.md >> GEMINI.md`);
}

// -- Run ----------------------------------------------------------------------

generate();
