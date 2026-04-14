#!/usr/bin/env bun
/**
 * Cross-platform copy/clean utilities for bundling core/ and adapters/
 * into cli/ before npm publish. Uses Node.js fs APIs (supported by Bun)
 * instead of shell commands for Windows compatibility.
 */

import { cpSync, rmSync, existsSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

const root = resolve(import.meta.dir, "..");
const coreSrc = resolve(root, "core");
const coreDest = resolve(root, "cli", "core");
const adaptersSrc = resolve(root, "adapters");
const adaptersDest = resolve(root, "cli", "adapters");

export function copyCore(): void {
  if (!existsSync(coreSrc)) {
    throw new Error(`Source core/ not found at ${coreSrc}`);
  }
  if (existsSync(coreDest)) {
    rmSync(coreDest, { recursive: true });
  }
  cpSync(coreSrc, coreDest, { recursive: true });
  console.log(`  Copied core/ → cli/core/`);

  // Also copy adapters — but strip dev-only cruft (node_modules, lockfiles,
  // session data, tests). Keep only runtime-relevant files so the CLI tarball
  // stays small. Standalone users install @aos-harness/<name>-adapter directly.
  if (existsSync(adaptersSrc)) {
    if (existsSync(adaptersDest)) {
      rmSync(adaptersDest, { recursive: true });
    }
    const EXCLUDED_SEGMENTS = new Set([
      "node_modules",
      ".aos",
      "tests",
      "test",
      "__tests__",
    ]);
    const EXCLUDED_FILES = new Set([
      "bun.lock",
      "bun.lockb",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      ".DS_Store",
    ]);
    cpSync(adaptersSrc, adaptersDest, {
      recursive: true,
      filter: (src) => {
        const rel = relative(adaptersSrc, src);
        if (!rel) return true;
        const parts = rel.split(sep);
        if (parts.some((p) => EXCLUDED_SEGMENTS.has(p))) return false;
        const basename = parts[parts.length - 1];
        if (basename && EXCLUDED_FILES.has(basename)) return false;
        return true;
      },
    });
    console.log(`  Copied adapters/ → cli/adapters/ (runtime files only)`);
  }
}

export function cleanCore(): void {
  if (existsSync(coreDest)) {
    rmSync(coreDest, { recursive: true });
    console.log(`  Cleaned cli/core/`);
  }
  if (existsSync(adaptersDest)) {
    rmSync(adaptersDest, { recursive: true });
    console.log(`  Cleaned cli/adapters/`);
  }
}

// Allow running directly: bun run scripts/copy-core.ts [copy|clean]
if (import.meta.main) {
  const action = process.argv[2] ?? "copy";
  if (action === "copy") copyCore();
  else if (action === "clean") cleanCore();
  else console.error(`Unknown action: ${action}. Use "copy" or "clean".`);
}
