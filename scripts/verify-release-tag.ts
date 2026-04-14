#!/usr/bin/env bun
/**
 * Verify the pushed tag matches the repo state before release. Spec D2.
 * Called by the release workflow as the first substantive step.
 *
 * Checks:
 *  1. GITHUB_REF_NAME (or argv[2]) is the tag currently at HEAD
 *  2. Tag is annotated (not lightweight)
 *  3. Worktree is clean
 *  4. Tag name is `v<version>` and <version> matches every published package.json
 */
import { $ } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PUBLISHED = [
  "cli", "runtime",
  "adapters/shared", "adapters/claude-code", "adapters/codex", "adapters/gemini", "adapters/pi",
];

const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
if (!tag) { console.error("usage: verify-release-tag.ts <tag> (or set GITHUB_REF_NAME)"); process.exit(2); }
if (!tag.startsWith("v")) { console.error(`tag must start with 'v': ${tag}`); process.exit(1); }
const expectedVersion = tag.slice(1);

async function sh(cmd: string): Promise<string> {
  const r = await $`sh -c ${cmd}`.nothrow().quiet();
  if (r.exitCode !== 0) throw new Error(`${cmd} failed: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

try {
  // 1. Tag at HEAD
  const head = await sh("git rev-parse HEAD");
  const tagged = await sh(`git rev-list -n 1 ${tag}`);
  if (head !== tagged) {
    console.error(`tag ${tag} (${tagged.slice(0,7)}) does not point at HEAD (${head.slice(0,7)})`);
    process.exit(1);
  }

  // 2. Annotated tag
  const tagType = await sh(`git cat-file -t ${tag}`);
  if (tagType !== "tag") {
    console.error(`tag ${tag} is lightweight (${tagType}), expected annotated. Use git tag -a.`);
    process.exit(1);
  }

  // 3. Clean worktree
  const dirty = await sh("git status --porcelain");
  if (dirty) { console.error("worktree is dirty (uncommitted changes):\n" + dirty); process.exit(1); }

  // 4. Version lockstep
  for (const dir of PUBLISHED) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as { version: string };
    if (pkg.version !== expectedVersion) {
      console.error(`version mismatch: ${dir}/package.json = ${pkg.version}, tag = ${tag} (expected ${expectedVersion})`);
      process.exit(1);
    }
  }

  console.log(`verify-release-tag: ${tag} verified across ${PUBLISHED.length} packages`);
  process.exit(0);
} catch (err: any) {
  console.error(`verify-release-tag: ${err.message}`);
  process.exit(1);
}
