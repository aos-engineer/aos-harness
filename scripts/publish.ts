#!/usr/bin/env bun
/**
 * AOS Harness — Monorepo Publish Script
 *
 * Publishes all workspace packages to npm in dependency order with
 * lockstep version enforcement. Idempotent: if a package version already
 * exists on the registry, that package is skipped and the script continues.
 *
 * Dry-run by default. Pass --confirm to actually publish.
 */

import { $ } from "bun";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { copyCore, cleanCore } from "./copy-core";

const root = resolve(import.meta.dir, "..");
const confirm = process.argv.includes("--confirm");

type PublishEntry = {
  dir: string;
  name: string;
  pinDeps: string[];
  postPublish?: () => void;
  prePublish?: () => void;
};

const PUBLISH_ORDER: PublishEntry[] = [
  { dir: "runtime",                name: "@aos-harness/runtime",             pinDeps: [] },
  { dir: "adapters/shared",        name: "@aos-harness/adapter-shared",      pinDeps: ["@aos-harness/runtime"] },
  { dir: "adapters/claude-code",   name: "@aos-harness/claude-code-adapter", pinDeps: ["@aos-harness/runtime", "@aos-harness/adapter-shared"] },
  { dir: "adapters/codex",         name: "@aos-harness/codex-adapter",       pinDeps: ["@aos-harness/runtime", "@aos-harness/adapter-shared"] },
  { dir: "adapters/gemini",        name: "@aos-harness/gemini-adapter",      pinDeps: ["@aos-harness/runtime", "@aos-harness/adapter-shared"] },
  { dir: "adapters/pi",            name: "@aos-harness/pi-adapter",          pinDeps: ["@aos-harness/runtime", "@aos-harness/adapter-shared"] },
  {
    dir: "cli",
    name: "aos-harness",
    pinDeps: ["@aos-harness/runtime", "@aos-harness/adapter-shared"],
    prePublish: () => copyCore(),
    postPublish: () => cleanCore(),
  },
];

function readPkg(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf-8"));
}

function readPkgRaw(dir: string): string {
  return readFileSync(resolve(root, dir, "package.json"), "utf-8");
}

function writePkg(dir: string, content: string): void {
  writeFileSync(resolve(root, dir, "package.json"), content, "utf-8");
}

function pinWorkspaceDeps(raw: string, pinMap: Record<string, string>): string {
  let out = raw;
  for (const [depName, version] of Object.entries(pinMap)) {
    const pattern = new RegExp(`"${depName.replace(/[/@-]/g, "\\$&")}":\\s*"workspace:\\*"`, "g");
    out = out.replace(pattern, `"${depName}": "${version}"`);
  }
  return out;
}

function isAlreadyPublished(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes("already exists") ||
    s.includes("cannot publish over") ||
    s.includes("you cannot publish over the previously published versions") ||
    (s.includes("403") && s.includes("previously published"))
  );
}

async function publishWithPinnedDeps(entry: PublishEntry, pinMap: Record<string, string>): Promise<void> {
  const cwd = resolve(root, entry.dir);
  const originalRaw = readPkgRaw(entry.dir);
  const version = (JSON.parse(originalRaw) as { version: string }).version;

  try {
    if (entry.prePublish) entry.prePublish();

    if (entry.pinDeps.length > 0) {
      const resolved = pinWorkspaceDeps(originalRaw, pinMap);
      writePkg(entry.dir, resolved);
    }

    if (entry.dir === "cli") {
      const bundledAdapters = ["pi", "claude-code", "gemini", "codex", "shared"];
      for (const adapterName of bundledAdapters) {
        const adapterPkgPath = resolve(root, "cli", "adapters", adapterName, "package.json");
        if (existsSync(adapterPkgPath)) {
          const adapterRaw = readFileSync(adapterPkgPath, "utf-8");
          writeFileSync(adapterPkgPath, pinWorkspaceDeps(adapterRaw, pinMap), "utf-8");
        }
      }
    }

    const label = `${entry.name}@${version}`;
    if (!confirm) {
      console.log(`  [dry-run] bun publish --dry-run  (${label})`);
      const result = await $`bun publish --dry-run`.cwd(cwd).quiet().nothrow();
      if (result.exitCode !== 0) {
        console.log(`    ⚠ dry-run issue: ${result.stderr.toString().trim()}`);
      } else {
        console.log(`    ✓ would publish ${label}`);
      }
    } else {
      console.log(`  Publishing ${label}...`);
      const result = await $`bun publish --access public`.cwd(cwd).nothrow();
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString();
        if (isAlreadyPublished(stderr)) {
          console.log(`  ⤳ ${label} already exists on registry — skipping`);
        } else {
          console.error(`  ✗ Failed to publish ${label}\n${stderr}`);
          throw new Error(`Publish failed for ${entry.name}`);
        }
      } else {
        console.log(`  ✓ Published ${label}`);
      }
    }
  } finally {
    writePkg(entry.dir, originalRaw);
    if (entry.postPublish) entry.postPublish();
  }
}

async function main() {
  console.log("=== AOS Harness Publish ===\n");

  console.log("▸ Running unit tests...");
  const testResult = await $`bun test --cwd ${resolve(root, "runtime")}`.quiet().nothrow();
  if (testResult.exitCode !== 0) {
    console.error("✗ Unit tests failed:\n", testResult.stderr.toString());
    process.exit(1);
  }
  console.log("✓ Unit tests passed\n");

  console.log("▸ Running integration validation...");
  const integrationScript = resolve(root, "tests/integration/validate-config.ts");
  const intResult = await $`bun run ${integrationScript}`.quiet().nothrow();
  if (intResult.exitCode !== 0) {
    console.error("✗ Integration validation failed:\n", intResult.stderr.toString());
    process.exit(1);
  }
  console.log("✓ Integration validation passed\n");

  const versions = new Map<string, string>();
  for (const entry of PUBLISH_ORDER) {
    const pkg = readPkg(entry.dir);
    versions.set(entry.name, pkg.version as string);
  }
  const releaseVersion = versions.get("@aos-harness/runtime")!;
  const mismatches = [...versions.entries()].filter(([, v]) => v !== releaseVersion);
  if (mismatches.length > 0) {
    console.error(`✗ Lockstep violation: expected all packages at ${releaseVersion}`);
    for (const [name, v] of mismatches) console.error(`  ${name}@${v}`);
    process.exit(1);
  }
  console.log(`▸ Release version: ${releaseVersion}\n`);

  const pinMap: Record<string, string> = {
    "@aos-harness/runtime": releaseVersion,
    "@aos-harness/adapter-shared": releaseVersion,
  };

  console.log("▸ Packages to publish:\n");
  for (const entry of PUBLISH_ORDER) console.log(`  ${entry.name}@${releaseVersion}  (${entry.dir}/)`);
  console.log();

  for (const entry of PUBLISH_ORDER) {
    await publishWithPinnedDeps(entry, pinMap);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
