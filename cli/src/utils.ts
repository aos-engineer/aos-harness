/**
 * Shared utilities for CLI commands.
 */

import { join, normalize, resolve, sep } from "node:path";
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
 * Resolve an adapter directory on disk. Returns the directory containing
 * `src/index.ts` for the named adapter, or null if none found.
 *
 * Checked in order:
 * 1. Monorepo dev layout: harness-root/adapters/<name>/
 * 2. Installed standalone package: node_modules/@aos-harness/<name>-adapter/
 *    (via import.meta.resolve). Post-0.6.0 this is the primary path —
 *    the CLI no longer bundles adapter source.
 */
export function getAdapterDir(adapterName: string): string | null {
  // 1. Monorepo dev layout
  const monorepoDir = resolve(import.meta.dir, "../..", "adapters", adapterName);
  if (existsSync(join(monorepoDir, "src", "index.ts"))) {
    return monorepoDir;
  }

  // 2. Installed @aos-harness/<name>-adapter package
  try {
    const pkgName = `@aos-harness/${adapterName}-adapter`;
    const resolver = (import.meta as any).resolve;
    if (typeof resolver !== "function") return null;
    // import.meta.resolve returns a file:// URL to the package's main entry
    // (e.g., .../node_modules/@aos-harness/pi-adapter/src/index.ts). Strip
    // to the package root.
    const mainUrl: string = resolver(pkgName);
    if (!mainUrl.startsWith("file://")) return null;
    const mainPath = mainUrl.slice("file://".length);
    // Walk up until we find a package.json with the matching name
    let dir = resolve(mainPath, "..");
    const fsRoot = resolve("/");
    while (dir !== fsRoot) {
      const pkgJson = join(dir, "package.json");
      if (existsSync(pkgJson)) {
        try {
          // Confirm it's the right package; if so, return dir.
          const contents = JSON.parse(
            require("node:fs").readFileSync(pkgJson, "utf-8"),
          ) as { name?: string };
          if (contents.name === pkgName) {
            if (existsSync(join(dir, "src", "index.ts"))) return dir;
          }
        } catch {
          // Fall through — keep walking up.
        }
      }
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // import.meta.resolve throws if the package isn't installed.
    return null;
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

/**
 * Adapters the CLI is permitted to load. Security boundary, not a convenience
 * list: expanding it requires a CLI release because every entry has been
 * reviewed by a CLI maintainer. Spec D2.
 */
export const ADAPTER_ALLOWLIST = ["pi", "claude-code", "codex", "gemini"] as const;
export type AdapterName = typeof ADAPTER_ALLOWLIST[number];

export function isValidAdapter(name: unknown): name is AdapterName {
  return typeof name === "string" && (ADAPTER_ALLOWLIST as readonly string[]).includes(name);
}

/**
 * Resolve `rel` against `base` and require the result stays inside `base`.
 * Throws if `rel` escapes. Use for any path value sourced from config or
 * adapter output (spec D4). Direct CLI args from the user are NOT passed
 * through this — the user trusts themselves.
 */
export function confinedResolve(base: string, rel: string): string {
  const absBase = normalize(resolve(base));
  const absTarget = normalize(resolve(absBase, rel));
  if (absTarget !== absBase && !absTarget.startsWith(absBase + sep)) {
    throw new Error(`Path escapes base directory: ${rel}`);
  }
  return absTarget;
}

/**
 * Validate a platform URL (telemetry endpoint). Rejects non-http(s), plain
 * http to non-loopback hosts, and link-local / metadata-service addresses
 * (169.254.0.0/16). See spec D5 for DNS-rebinding caveat.
 *
 * Bypass: set AOS_ALLOW_INSECURE_PLATFORM_URL=1 for internal testing only.
 */
export function validatePlatformUrl(raw: string): URL {
  if (process.env.AOS_ALLOW_INSECURE_PLATFORM_URL === "1") {
    return new URL(raw); // still throws on parse failure
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`platform.url rejected: unparseable URL "${raw}"`);
  }

  const isLoopbackHost = u.hostname === "localhost" || u.hostname === "127.0.0.1";

  // Link-local / metadata service: 169.254.0.0/16
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(u.hostname)) {
    throw new Error(`platform.url rejected: link-local / metadata address ${u.hostname}`);
  }

  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopbackHost)) {
    throw new Error(`platform.url rejected: scheme "${u.protocol.replace(":", "")}" not allowed`);
  }

  return u;
}

/**
 * Parse the `--allow-code-execution[=<val>]` flag (spec D3.2).
 *
 * Semantics (narrow-only — never widens the profile):
 *   undefined         → undefined   (no flag: use profile as-is)
 *   true (bare flag)  → "all"       (no-op vs profile)
 *   "" or "all"       → "all"
 *   "none"            → "none"      (force-deny)
 *   "python,bash"     → ["python", "bash"]  (narrow to set; buildToolPolicy
 *                                             will reject widening attempts)
 */
export function parseAllowCodeExecutionFlag(
  raw: unknown,
): "none" | "all" | string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === true) return "all";
  if (typeof raw !== "string") return undefined;
  if (raw === "none") return "none";
  if (raw === "all" || raw === "") return "all";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
