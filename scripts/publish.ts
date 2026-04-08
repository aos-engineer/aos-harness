#!/usr/bin/env bun
/**
 * AOS Harness — Monorepo Publish Script
 *
 * Runs tests, validates configs, and publishes all packages.
 * Dry-run by default. Pass --confirm to actually publish.
 */

import { $ } from "bun";
import { readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");
const confirm = process.argv.includes("--confirm");

const packages = [
  "runtime",
  "cli",
  "adapters/pi",
  "adapters/claude-code",
  "adapters/gemini",
];

function readPkg(dir: string) {
  try {
    return JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf-8"));
  } catch {
    return null;
  }
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

  // 3. List packages and versions
  console.log("▸ Packages to publish:\n");
  const publishable: { name: string; version: string; dir: string }[] = [];

  for (const dir of packages) {
    const pkg = readPkg(dir);
    if (!pkg) {
      console.log(`  ⊘ ${dir} — not found, skipping`);
      continue;
    }
    console.log(`  ${pkg.name}@${pkg.version}  (${dir}/)`);
    publishable.push({ name: pkg.name, version: pkg.version, dir });
  }

  console.log(`\n  Total: ${publishable.length} packages\n`);

  // 4. Publish
  if (!confirm) {
    console.log("⚑ Dry-run mode. Pass --confirm to publish for real.\n");
    for (const pkg of publishable) {
      const cwd = resolve(root, pkg.dir);
      console.log(`  [dry-run] bun publish --dry-run  (${pkg.name})`);
      const result = await $`bun publish --dry-run`.cwd(cwd).quiet().nothrow();
      if (result.exitCode !== 0) {
        console.log(`    ⚠ dry-run issue: ${result.stderr.toString().trim()}`);
      } else {
        console.log(`    ✓ would publish ${pkg.name}@${pkg.version}`);
      }
    }
  } else {
    console.log("Publishing for real...\n");
    for (const pkg of publishable) {
      const cwd = resolve(root, pkg.dir);
      console.log(`  Publishing ${pkg.name}@${pkg.version}...`);
      const result = await $`bun publish --access public`.cwd(cwd).nothrow();
      if (result.exitCode !== 0) {
        console.error(`  ✗ Failed to publish ${pkg.name}`);
        process.exit(1);
      }
      console.log(`  ✓ Published ${pkg.name}@${pkg.version}`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
