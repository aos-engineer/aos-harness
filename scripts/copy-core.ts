#!/usr/bin/env bun
/**
 * Cross-platform copy/clean utilities for bundling core/ into cli/ before
 * npm publish. Uses Node.js fs APIs (supported by Bun) instead of shell
 * commands for Windows compatibility.
 *
 * As of 0.6.0 the CLI no longer bundles adapter source — adapters are
 * installed standalone by users via @aos-harness/<name>-adapter.
 */

import { cpSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const coreSrc = resolve(root, "core");
const coreDest = resolve(root, "cli", "core");

export function copyCore(): void {
  if (!existsSync(coreSrc)) {
    throw new Error(`Source core/ not found at ${coreSrc}`);
  }
  if (existsSync(coreDest)) {
    rmSync(coreDest, { recursive: true });
  }
  cpSync(coreSrc, coreDest, { recursive: true });
  console.log(`  Copied core/ → cli/core/`);
}

export function cleanCore(): void {
  if (existsSync(coreDest)) {
    rmSync(coreDest, { recursive: true });
    console.log(`  Cleaned cli/core/`);
  }
}

// Allow running directly: bun run scripts/copy-core.ts [copy|clean]
if (import.meta.main) {
  const action = process.argv[2] ?? "copy";
  if (action === "copy") copyCore();
  else if (action === "clean") cleanCore();
  else console.error(`Unknown action: ${action}. Use "copy" or "clean".`);
}
