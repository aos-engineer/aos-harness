/**
 * Shared utilities for CLI commands.
 */

import { join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";

/**
 * Resolve the AOS harness root directory.
 * Walks up from the CLI source to find the harness root (where core/, runtime/, adapters/ live).
 */
export function getHarnessRoot(): string {
  // cli/src/utils.ts -> cli/src -> cli -> harness root
  return resolve(import.meta.dir, "../..");
}

/**
 * Discover all directories containing a given YAML file (e.g. agent.yaml)
 * by recursively walking a directory tree.
 */
export function discoverDirs(baseDir: string, yamlFile: string): string[] {
  const results: string[] = [];
  if (!existsSync(baseDir)) return results;

  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const subDir = join(baseDir, entry.name);
    if (existsSync(join(subDir, yamlFile))) {
      results.push(subDir);
    } else {
      results.push(...discoverDirs(subDir, yamlFile));
    }
  }
  return results;
}

/**
 * Convert a name to kebab-case.
 */
export function toKebabCase(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/**
 * Prompt user to select from a list of options (simple numbered list).
 */
export async function promptSelect(label: string, options: string[]): Promise<number> {
  console.log(`\n${label}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}. ${options[i]}`);
  }

  process.stdout.write("\nEnter number: ");

  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();

  if (!value) {
    throw new Error("No input received.");
  }

  const input = new TextDecoder().decode(value).trim();
  const index = parseInt(input, 10) - 1;

  if (isNaN(index) || index < 0 || index >= options.length) {
    throw new Error(`Invalid selection: "${input}". Expected a number between 1 and ${options.length}.`);
  }

  return index;
}
