#!/usr/bin/env bun
/**
 * Cross-platform copy/clean utilities for bundling core/ and adapters/
 * into cli/ before npm publish. Uses Node.js fs APIs (supported by Bun)
 * instead of shell commands for Windows compatibility.
 */

import { cpSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

  // Also copy adapters
  if (existsSync(adaptersSrc)) {
    if (existsSync(adaptersDest)) {
      rmSync(adaptersDest, { recursive: true });
    }
    cpSync(adaptersSrc, adaptersDest, { recursive: true });
    console.log(`  Copied adapters/ → cli/adapters/`);
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
