#!/usr/bin/env bun
/**
 * AOS Harness — Monorepo Publish Script
 *
 * Publishes @aos-harness/runtime and aos-harness (CLI) to npm.
 * Handles core/ bundling and workspace:* resolution with try/finally safety.
 *
 * Dry-run by default. Pass --confirm to actually publish.
 */

import { $ } from "bun";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { copyCore, cleanCore } from "./copy-core";

const root = resolve(import.meta.dir, "..");
const confirm = process.argv.includes("--confirm");

function readPkg(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf-8"));
  } catch {
    return null;
  }
}

function readPkgRaw(dir: string): string {
  return readFileSync(resolve(root, dir, "package.json"), "utf-8");
}

function writePkg(dir: string, content: string): void {
  writeFileSync(resolve(root, dir, "package.json"), content, "utf-8");
}

async function main() {
  console.log("=== AOS Harness Publish ===\n");

  // 1. Run unit tests
  console.log("▸ Running unit tests...");
  const testResult = await $`bun test --cwd ${resolve(root, "runtime")}`.quiet().nothrow();
  if (testResult.exitCode !== 0) {
    console.error("✗ Unit tests failed:\n", testResult.stderr.toString());
    process.exit(1);
  }
  console.log("✓ Unit tests passed\n");

  // 2. Run integration validation
  console.log("▸ Running integration validation...");
  const integrationScript = resolve(root, "tests/integration/validate-config.ts");
  const intResult = await $`bun run ${integrationScript}`.quiet().nothrow();
  if (intResult.exitCode !== 0) {
    console.error("✗ Integration validation failed:\n", intResult.stderr.toString());
    process.exit(1);
  }
  console.log("✓ Integration validation passed\n");

  // 3. Read package versions
  const runtimePkg = readPkg("runtime");
  const sharedPkg = readPkg("adapters/shared");
  const cliPkg = readPkg("cli");
  if (!runtimePkg || !cliPkg) {
    console.error("✗ Could not read package.json for runtime or cli");
    process.exit(1);
  }

  const runtimeVersion = runtimePkg.version as string;
  const sharedVersion = sharedPkg?.version as string ?? runtimeVersion;
  const cliVersion = cliPkg.version as string;
  console.log(`▸ Packages to publish:\n`);
  console.log(`  ${runtimePkg.name}@${runtimeVersion}  (runtime/)`);
  if (sharedPkg) console.log(`  ${sharedPkg.name}@${sharedVersion}  (adapters/shared/)`);
  console.log(`  ${cliPkg.name}@${cliVersion}  (cli/)\n`);

  if (runtimeVersion !== cliVersion) {
    console.error(`✗ Version mismatch: runtime=${runtimeVersion}, cli=${cliVersion}`);
    process.exit(1);
  }

  // 4. Publish runtime first
  const runtimeCwd = resolve(root, "runtime");
  if (!confirm) {
    console.log(`  [dry-run] bun publish --dry-run  (${runtimePkg.name})`);
    const result = await $`bun publish --dry-run`.cwd(runtimeCwd).quiet().nothrow();
    if (result.exitCode !== 0) {
      console.log(`    ⚠ dry-run issue: ${result.stderr.toString().trim()}`);
    } else {
      console.log(`    ✓ would publish ${runtimePkg.name}@${runtimeVersion}`);
    }
  } else {
    console.log(`  Publishing ${runtimePkg.name}@${runtimeVersion}...`);
    const result = await $`bun publish --access public`.cwd(runtimeCwd).nothrow();
    if (result.exitCode !== 0) {
      console.error(`  ✗ Failed to publish ${runtimePkg.name}`);
      process.exit(1);
    }
    console.log(`  ✓ Published ${runtimePkg.name}@${runtimeVersion}\n`);
  }

  // 5. Publish adapter-shared (dependency of all adapters)
  if (sharedPkg) {
    const sharedCwd = resolve(root, "adapters/shared");
    const originalSharedPkg = readPkgRaw("adapters/shared");

    try {
      // Pin workspace dependency
      const resolvedShared = originalSharedPkg.replace(
        `"@aos-harness/runtime": "workspace:*"`,
        `"@aos-harness/runtime": "${runtimeVersion}"`,
      );
      writePkg("adapters/shared", resolvedShared);

      if (!confirm) {
        console.log(`  [dry-run] bun publish --dry-run  (${sharedPkg.name})`);
        const result = await $`bun publish --dry-run`.cwd(sharedCwd).quiet().nothrow();
        if (result.exitCode !== 0) {
          console.log(`    ⚠ dry-run issue: ${result.stderr.toString().trim()}`);
        } else {
          console.log(`    ✓ would publish ${sharedPkg.name}@${sharedVersion}`);
        }
      } else {
        console.log(`  Publishing ${sharedPkg.name}@${sharedVersion}...`);
        const result = await $`bun publish --access public`.cwd(sharedCwd).nothrow();
        if (result.exitCode !== 0) {
          console.error(`  ✗ Failed to publish ${sharedPkg.name}`);
          throw new Error(`Publish failed for ${sharedPkg.name}`);
        }
        console.log(`  ✓ Published ${sharedPkg.name}@${sharedVersion}\n`);
      }
    } finally {
      writePkg("adapters/shared", originalSharedPkg);
      console.log("  Restored adapters/shared/package.json");
    }
  }

  // 6. Publish CLI with core bundling and workspace resolution
  const cliCwd = resolve(root, "cli");
  const originalPkgJson = readPkgRaw("cli");

  try {
    // Copy core/ into cli/core/
    console.log("  Bundling core configs...");
    copyCore();

    // Replace workspace:* with pinned version in CLI package
    const resolved = originalPkgJson.replace(
      `"@aos-harness/runtime": "workspace:*"`,
      `"@aos-harness/runtime": "${runtimeVersion}"`,
    );
    writePkg("cli", resolved);

    // Also resolve workspace:* in bundled adapter package.json files
    const bundledAdapters = ["pi", "claude-code", "gemini", "codex", "shared"];
    for (const adapterName of bundledAdapters) {
      const adapterPkgPath = resolve(root, "cli", "adapters", adapterName, "package.json");
      if (existsSync(adapterPkgPath)) {
        const adapterPkgRaw = readFileSync(adapterPkgPath, "utf-8");
        const resolvedAdapter = adapterPkgRaw
          .replace(`"@aos-harness/runtime": "workspace:*"`, `"@aos-harness/runtime": "${runtimeVersion}"`)
          .replace(`"@aos-harness/adapter-shared": "workspace:*"`, `"@aos-harness/adapter-shared": "${sharedVersion}"`);
        writeFileSync(adapterPkgPath, resolvedAdapter, "utf-8");
      }
    }
    console.log(`  Pinned workspace:* references to ${runtimeVersion}`);
    console.log(`  Pinned @aos-harness/runtime to ${runtimeVersion}`);

    if (!confirm) {
      console.log(`  [dry-run] bun publish --dry-run  (${cliPkg.name})`);
      const result = await $`bun publish --dry-run`.cwd(cliCwd).quiet().nothrow();
      if (result.exitCode !== 0) {
        console.log(`    ⚠ dry-run issue: ${result.stderr.toString().trim()}`);
      } else {
        console.log(`    ✓ would publish ${cliPkg.name}@${cliVersion}`);
      }
    } else {
      console.log(`  Publishing ${cliPkg.name}@${cliVersion}...`);
      const result = await $`bun publish --access public`.cwd(cliCwd).nothrow();
      if (result.exitCode !== 0) {
        console.error(`  ✗ Failed to publish ${cliPkg.name}`);
        throw new Error(`Publish failed for ${cliPkg.name}`);
      }
      console.log(`  ✓ Published ${cliPkg.name}@${cliVersion}`);
    }
  } finally {
    // Always restore original package.json and clean core/
    writePkg("cli", originalPkgJson);
    console.log("  Restored cli/package.json");
    cleanCore();
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
