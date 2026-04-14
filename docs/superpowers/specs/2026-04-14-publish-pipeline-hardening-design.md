# Publish Pipeline Hardening Design

**Date:** 2026-04-14
**Status:** Draft — awaiting review
**Scope:** Move npm publish from a developer laptop to a tag-triggered GitHub Actions release workflow with provenance, required approval, and signed-tag verification. Replace the bypassable YAML-safety grep with an AST check. Harden surrounding publish-script operations. Close one CI hygiene gap.
**Related report:** `docs/security-scan-report-2026-04-14.md` (SUPPLY-001/002/003/004/005/006/007, SECRET-001).
**Partner spec:** `2026-04-14-adapter-trust-model-design.md` (runtime trust boundaries).

## Goal

Every version of `aos-harness` and the six adapter packages that hits npm after this ships must be:

1. Built and published by **GitHub Actions**, not a developer laptop.
2. **Attested with npm provenance** — the package.json's `dist.provenance` block binds the tarball to a specific commit, workflow run, and public attestation.
3. Gated on **lint + typecheck + tests all green**, a **clean worktree**, and the **tag matches the package version**.
4. Approved by a **second human** via a protected GitHub environment.

And the developer-side `scripts/publish.ts` becomes a local **dry-run / pack** tool, not a publish tool.

## Why

- SUPPLY-002/003: No `--provenance`. Anyone with the npm token can publish any local state, including uncommitted changes, from any machine. There is no cryptographic attestation binding a published tarball to a source commit.
- SUPPLY-001: The `prerelease` script (`lint && test`) is only auto-invoked for npm's built-in `publish` lifecycle, not for `publish:all`. Typecheck and the YAML-safety lint can silently be skipped on release.
- SUPPLY-006: The YAML-safety lint itself is a grep chain that misses destructured imports (`const { load } = yaml; load(x)`), whitespace variants, any file path containing the literal substring `test` (including `latest-config.ts`), and any `JSON_SCHEMA` occurrence on the same line (including comments). It scans `runtime/src/` and `adapters/` only — not `cli/` or `core/`. It is security theater.
- SUPPLY-005/007: `copy-core.ts` does `rmSync(..., { recursive: true })` with no symlink check. `publish.ts` mutates workspace package.json files in place and relies on `try/finally` for restoration — SIGKILL leaves pinned versions checked out.
- SECRET-001: `.github/workflows/ci.yml` lacks a top-level `permissions:` block. Mitigated by `pull_request` (not `pull_request_target`), but it's free hygiene.

Timing: we just shipped 0.5.0 → 0.5.1 → 0.5.2 → 0.6.0 in rapid succession from local machines. The next release (0.7.0, carrying the adapter-trust-model changes) is the right moment to switch — before the package has enough consumer gravity that a provenance-less tarball becomes hard to reason about.

## Non-Goals

- Publishing to registries other than npm.
- Sigstore / cosign outside of what npm's built-in provenance already uses.
- Removing `scripts/publish.ts` — we retain it as a local dry-run (produces tarballs, never calls `npm publish`).
- Automating version bumps / changelogs. Authors still hand-write `CHANGELOG.md` and run `npm version`. The release workflow only reacts to pushed tags.
- Lockfile verification beyond what `bun install --frozen-lockfile` already provides.

## Decisions

### D1 — Tag-triggered release workflow (`.github/workflows/release.yml`)

```yaml
name: release
on:
  push:
    tags: ["v*"]

permissions:
  contents: read
  id-token: write           # required for npm provenance

jobs:
  release:
    runs-on: ubuntu-latest
    environment: npm-publish   # GitHub environment with required reviewers + NPM_TOKEN secret
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0        # git history needed for tag verification
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"

      - name: Verify tag matches package version
        run: bun run scripts/verify-release-tag.ts

      - name: Install (frozen)
        run: bun install --frozen-lockfile

      - name: Lint + typecheck
        run: bun run lint

      - name: Unit tests
        run: bun test

      - name: Integration
        run: bun run test:integration

      - name: Publish all packages with provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: bun run scripts/publish.ts --ci
```

Key properties:

- **`permissions: { contents: read, id-token: write }`** — principle of least privilege; `id-token` is mandatory for provenance and nothing else.
- **`environment: npm-publish`** — GitHub environment configured in repo settings with 1 required reviewer and the `NPM_TOKEN` secret scoped to this environment only. This is the approval gate.
- **`actions/setup-node` + `registry-url`** sets up `.npmrc` with the auth-token variable name; `NODE_AUTH_TOKEN` (not `NPM_TOKEN`) is the value the token gets exported as. This is the standard npm publish flow in CI and avoids token-echoing.
- **Tag verification step** before anything expensive runs — fast fail.
- **`bun install --frozen-lockfile`** — cannot drift during CI.
- **Single `bun run lint`** runs the `lint:yaml-safety` + `typecheck` chain (after D3 rewrites `lint:yaml-safety`).

### D2 — `scripts/verify-release-tag.ts`

New file. ~40 lines. Validates:

1. `git rev-parse --verify --quiet HEAD` equals `git rev-list -n 1 $GITHUB_REF_NAME` (tag points at HEAD).
2. Tag name matches `v<version>` where `<version>` is the version in **all** seven published workspace `package.json` files (lockstep check).
3. `git status --porcelain` is empty (clean worktree — redundant in fresh CI checkout but cheap insurance and documents the invariant).
4. Tag is annotated, not lightweight: `git cat-file -t <tag>` returns `tag`, not `commit`. We do not require GPG signing (tolerant to contributors without signing keys), but annotated-tag is free and provides author+date metadata.

Exits `0` on pass, `1` on fail with a clear message. Locally runnable too — `bun run scripts/verify-release-tag.ts v0.7.0`.

### D3 — Replace `scripts/check-yaml-safety.sh` with an AST-based lint

Drop the shell script. New file `scripts/check-yaml-safety.ts` that uses the TypeScript compiler API (already a Bun-runtime dependency) — no new dependencies — to walk every `.ts` file under `cli/`, `runtime/`, `adapters/`, and `core/` (if it has `.ts`) and find `CallExpression`s where the callee resolves to `yaml.load` (any binding path: `yaml.load`, destructured `load`, aliased `import { load as l }`). For each, assert the second argument is an `ObjectLiteralExpression` with a `schema` property whose value is either `yaml.JSON_SCHEMA` or `yaml.FAILSAFE_SCHEMA`.

```ts
// High-level algorithm
1. Glob **/*.ts in cli/, runtime/, adapters/, core/. Exclude node_modules, **/*.test.ts, **/tests/**.
2. For each file, ts.createSourceFile(fileContent).
3. Walk the AST. For each CallExpression:
   a. Resolve callee to a symbol. Is it `yaml.load` or a destructured/aliased `load` from `js-yaml`?
   b. If yes, check args[1]: must be an object literal with `schema: yaml.JSON_SCHEMA` or `FAILSAFE_SCHEMA`.
4. Collect violations. If any, print `file:line: yaml.load missing safe schema: <snippet>` and exit 1.
```

Exclusions are path-scoped (`**/tests/**`, `**/*.test.ts`), not substring-based. No file with "test" in its name is automatically exempt.

The new lint is a direct replacement in `package.json`:
```diff
- "lint:yaml-safety": "bash scripts/check-yaml-safety.sh",
+ "lint:yaml-safety": "bun run scripts/check-yaml-safety.ts",
```

### D4 — `scripts/publish.ts --ci` vs local modes

The script grows a `--ci` flag:

- **`--ci`** (used only in the release workflow):
  - Assumes pre-validated environment (tag, lint, tests already ran).
  - Pins workspace deps, runs `bun publish --access public --provenance`, unpins, exits.
  - No `prompts`, no interactive confirmations, no `sleep`.
- **`--dry-run`** (default for local):
  - Pins workspace deps into a `.tmp-publish/` directory tree **instead of mutating the source**.
  - Runs `bun publish --dry-run --pack-destination .tmp-publish/tarballs/` per package.
  - Verifies the resulting tarballs have the expected `files` set, no stray `.env`, etc.
  - Cleans up `.tmp-publish/` on success and on failure (via `try/finally` on the directory, which is safe because deleting a tempdir does not corrupt source).
- Without either flag: print usage and exit.

The `--dry-run` temp-directory approach retires the in-place pin/restore dance (SUPPLY-007). A `SIGKILL` cannot leave the workspace with pinned versions because the pins were never applied to the workspace — they're applied in a copy. `--ci` keeps the in-place approach because the CI workspace is disposable.

### D5 — Harden `scripts/copy-core.ts`

Two small changes:

1. Before `rmSync(target, { recursive: true })`, `lstatSync(target)` and refuse if `isSymbolicLink()`. Symlink handling in `rmSync(..., { recursive: true })` *follows* the link on some Node/Bun versions; the `lstat` guard eliminates that surface entirely.
2. Assert `target` is under `cli/core` (startsWith check against an absolute `resolve(root, "cli", "core")`). Defense-in-depth against a future refactor that parameterizes the target.

Both are 4-line additions. No behavior change in the happy path.

### D6 — Per-package `publishConfig`

Every published package (`cli`, `runtime`, `adapters/shared`, `adapters/claude-code`, `adapters/codex`, `adapters/gemini`, `adapters/pi`) gets:

```json
"publishConfig": {
  "access": "public",
  "provenance": true
}
```

With `provenance: true` set per-package, `--provenance` on the CLI is redundant but harmless. Belt and suspenders; if someone runs `bun publish` from a workspace directly in CI without the flag, it still produces provenance.

Root `package.json` stays `private: true` — unchanged.

### D7 — CI workflow hygiene (`.github/workflows/ci.yml`)

Add one block at the top:

```yaml
permissions:
  contents: read
```

That's the whole fix for SECRET-001. One line.

### D8 — Registry-side controls

Not code changes, but part of the rollout checklist (documented in a new `docs/security/npm-release-runbook.md`):

- Enable **npm 2FA required for publish** on the `@aos-harness` scope (npm settings → packages → require 2FA).
- Rotate the existing `NPM_TOKEN`: revoke the current one, generate a new **automation token** (not a classic publish token — automation tokens bypass 2FA only from CI, which is what we want), scope it to the `@aos-harness` org, store it in the `npm-publish` GitHub environment.
- Add `aos-engineer` org members as required reviewers on the `npm-publish` environment. Minimum two members added; approval requires one.

## Architecture

```
Developer                         GitHub                          npm
---------                         ------                          ---
local dev                                                         
  bun run publish:dry-run  ──────────────────────────────────→  (nothing; verifies tarballs locally)
                                                                   
local release cut                                                 
  git tag -a v0.7.0                                               
  git push --tags          ─→  tag push event                     
                                  │                               
                                  ↓                               
                               release.yml:                       
                                 1. checkout                      
                                 2. verify-release-tag.ts         
                                 3. bun install --frozen          
                                 4. bun run lint                  
                                    ├── yaml-safety AST           
                                    └── typecheck                 
                                 5. tests                         
                                 6. (environment gate — human)    
                                 7. publish.ts --ci  ──────→  npm publish
                                                             (7 packages
                                                              with provenance)
```

No new services. No new secrets beyond the rotated `NPM_TOKEN`. No cross-repo integrations.

## Data Flow (tag → tarball)

1. Developer runs `bun run publish:dry-run` locally, inspects `.tmp-publish/tarballs/*.tgz`, edits CHANGELOG.
2. Developer runs `bun version <patch|minor|major>` → updates root package version only (manual lockstep across workspaces is already handled by the existing `publish.ts` pin logic, but for version-bump we either script it or do it by hand for seven files — spec is silent here, inherited from current workflow).
3. `git commit -am "chore(release): 0.7.0"`, `git tag -a v0.7.0 -m "…"`, `git push && git push --tags`.
4. `release.yml` fires on the tag push. Verifies tag-HEAD-version-lockstep consistency. Runs lint/tests.
5. Environment gate: one of the configured reviewers approves in the GitHub UI.
6. `publish.ts --ci` pins workspace deps, runs `bun publish --access public --provenance` per package in the existing `PUBLISH_ORDER`, unpins on success. Retry logic for "already published" (idempotency) stays.
7. Each tarball gets an npm provenance statement visible at `https://www.npmjs.com/package/<name>` and verifiable via `npm audit signatures`.

## Error Handling

- **Tag mismatch / dirty tree** → `verify-release-tag.ts` exits 1; workflow fails before any publish.
- **Lint or test failure** → standard CI failure.
- **YAML-safety violation** → `check-yaml-safety.ts` prints `file:line` list, exits 1.
- **No environment approval within 24h** → GitHub auto-cancels the waiting job; release can be re-triggered by re-pushing the same tag (or a `vN.N.N-rc1` retry tag).
- **`bun publish` fails mid-lockstep** (say, #3 of 7) → existing idempotent retry logic in `publish.ts` handles the "version already exists" case on re-run. Operator's fix: re-push the tag (fast-forward, no code change).
- **Provenance generation fails** (missing `id-token: write`) → `bun publish --provenance` errors loudly; fail-closed, never publishes without provenance.

## Testing

- **`scripts/verify-release-tag.ts`** unit-tested against a temp git repo fixture. Cases: tag at HEAD, tag not at HEAD, lightweight tag, dirty tree, version mismatch.
- **`scripts/check-yaml-safety.ts`** unit-tested with a fixture directory of `.ts` snippets covering: safe call, missing schema, destructured `load`, aliased import, value in a comment that contains `JSON_SCHEMA` (must still fail — no bypass via comment), test-directory exclusion (must pass — no scan).
- **`scripts/publish.ts --dry-run`** integration test asserts that after running it the workspace `package.json` files are bit-for-bit unchanged (diff against git HEAD).
- **CI workflow** itself: first tag push after merge is `v0.7.0-rc.1` (release candidate) → publish to the `next` dist-tag. Verify provenance shows up on npm and `npm audit signatures @aos-harness/pi-adapter@0.7.0-rc.1` passes. If the rc is clean, cut `v0.7.0`.

Existing tests unaffected.

## Migration & Rollout

Single release (0.7.0-rc.1 → 0.7.0). No user-visible behavior change. Consumers who run `npm audit signatures` start getting green checkmarks instead of yellow warnings on the `@aos-harness/*` packages.

Operator actions (one-time, in the order they must happen):

1. Merge D3 + D5 + D6 + D7 on a feature branch (they're pure local changes; no release-workflow involvement). Existing CI stays green.
2. Create GitHub environment `npm-publish`. Add required reviewers. Set `NPM_TOKEN` as a scoped secret.
3. Rotate npm token. Enable 2FA-required on the scope.
4. Merge D1 + D2 + D4 (release workflow + verify script + publish.ts --ci flag). CI doesn't fire on this (no tag).
5. Cut `v0.7.0-rc.1` → release workflow runs → approval → provenance verified.
6. Cut `v0.7.0` (real release).
7. Delete or comment out `publish:all` from root `package.json` scripts (or rename to `publish:dry-run`) to remove the "run locally" muscle memory.

## Open Questions

- Do we want to publish docs/security/npm-release-runbook.md in-repo, or keep it internal? **Proposed: in-repo under `docs/security/`**, so external contributors can understand the release trust chain without special access. Contains no secrets — only the process.
- Should `verify-release-tag.ts` require signed tags (`git verify-tag`)? **Proposed: no for 0.7.0, yes for 1.0.0.** Signing-key friction during pre-1.0 is not worth the marginal security on top of provenance + environment approval. Revisit at 1.0.
- Should the release workflow publish to the `next` dist-tag on any tag matching `v*-rc.*` automatically? **Proposed: yes.** One-line conditional in the workflow. Makes pre-release testing trivial.
- Do we want to retain the ability to publish from a laptop as a fallback if CI is down? **Proposed: no.** Emergency publishes bypass every security control we just added; better to fix CI. If genuine emergency, document a break-glass procedure (temporary token + explicit operator sign-off in an issue) but don't build it in.

Mark all as "decide during plan-writing" unless reviewer wants them settled now.
