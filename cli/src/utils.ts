/**
 * Shared utilities for CLI commands.
 */

import { join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";


/**
 * Resolve the AOS harness root directory.
 *
 * Resolution order:
 * 1. Walk up from cwd looking for a directory with core/agents/ (user's project)
 * 2. Fall back to the package install location (monorepo dev or npm install)
 *
 * This ensures commands like `aos list` find the user's project configs
 * after `aos init`, not the package's internal directory.
 */
export function getHarnessRoot(): string {
  // 1. Walk up from cwd looking for a project with core/
  let dir = process.cwd();
  const fsRoot = resolve("/");
  while (dir !== fsRoot) {
    if (existsSync(join(dir, "core", "agents"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  // 2. Fall back to package location (monorepo: cli/ -> root)
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

/**
 * Detect if the current directory (or ancestors) contains an AOS project.
 * Checks for core/agents/ or .aos/ directory.
 */
export function detectProject(startDir: string): string | null {
  let dir = startDir;
  const root = resolve("/");
  while (dir !== root) {
    if (existsSync(join(dir, "core", "agents")) || existsSync(join(dir, ".aos"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve the bundled core/ directory from the installed package.
 * Used when AOS is installed via npm (core/ lives inside the package,
 * not in the working directory).
 *
 * NOTE: import.meta.dir is Bun-specific. Do not refactor to __dirname
 * or import.meta.url — this is a deliberate Bun dependency.
 */
/**
 * Resolve an adapter directory from the installed package or monorepo.
 * Checks both npm install layout and monorepo dev layout.
 */
export function getAdapterDir(adapterName: string): string | null {
  const candidates = [
    resolve(import.meta.dir, "..", "adapters", adapterName),    // npm: package-root/adapters/
    resolve(import.meta.dir, "../..", "adapters", adapterName), // monorepo: harness-root/adapters/
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "src", "index.ts"))) {
      return dir;
    }
  }
  return null;
}

export function getPackageCoreDir(): string | null {
  // When installed via npm: src/utils.ts → src/ → package root (1 level up)
  // When in monorepo dev:   cli/src/utils.ts → cli/src → cli → root (2 levels up)
  const candidates = [
    resolve(import.meta.dir, "..", "core"),    // npm install: package-root/core
    resolve(import.meta.dir, "../..", "core"), // monorepo dev: harness-root/core
  ];
  for (const coreDir of candidates) {
    if (existsSync(join(coreDir, "agents"))) {
      return coreDir;
    }
  }
  return null;
}
