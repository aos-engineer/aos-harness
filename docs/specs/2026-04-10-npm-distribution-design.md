# AOS Harness npm Distribution Design

**Date:** 2026-04-10
**Status:** Draft
**Scope:** CLI and runtime packaging for npm distribution

## Overview

Make AOS Harness installable via `bun add -g aos-harness` and runnable via `bunx aos-harness`. Bun is a hard requirement — no Node.js compatibility layer. TypeScript source is the distribution — no build pipeline.

Two packages published to npm:

| Package | npm name | Purpose |
|---|---|---|
| CLI | `aos-harness` (unscoped) | CLI commands + bundled core configs (agents, profiles, domains, workflows, skills) |
| Runtime | `@aos-harness/runtime` (scoped) | Engine, types, modules for programmatic use |

## Install Experience

```bash
# Global install
bun add -g aos-harness
aos init

# One-shot via bunx
bunx aos-harness init

# Programmatic use (adapter/plugin developers)
bun add @aos-harness/runtime
```

## Runtime Requirement

Bun 1.0+ is the only supported runtime. Enforced via `"engines": { "bun": ">=1.0.0" }` in both packages. The CLI shebang remains `#!/usr/bin/env bun`. TypeScript source files are shipped as-is — Bun runs `.ts` natively, so no compilation step is needed.

## Package Contents

### aos-harness (CLI)

```
aos-harness/
├── src/                    # CLI commands (TypeScript)
│   ├── index.ts            # Entry point (#!/usr/bin/env bun)
│   ├── commands/           # init, run, create, validate, list, replay
│   ├── colors.ts
│   └── utils.ts
├── core/                   # Bundled core configs (copied on prepublish)
│   ├── agents/             # 13 agent definitions
│   ├── profiles/           # 6 orchestration profiles
│   ├── domains/            # 5 domain packs
│   ├── workflows/          # 7 workflow definitions
│   ├── skills/             # 3 skill definitions
│   ├── schema/             # JSON schema for validation
│   └── briefs/             # Sample briefs
├── package.json
└── README.md               # npm page README
```

### @aos-harness/runtime

```
@aos-harness/runtime/
├── src/                    # Engine and modules (TypeScript)
│   ├── engine.ts
│   ├── types.ts
│   ├── config-loader.ts
│   ├── constraint-engine.ts
│   ├── delegation-router.ts
│   ├── domain-merger.ts
│   ├── domain-enforcer.ts
│   ├── child-agent-manager.ts
│   ├── expertise-manager.ts
│   ├── event-summarizer.ts
│   ├── session-checkpoint.ts
│   ├── template-resolver.ts
│   ├── workflow-runner.ts
│   ├── artifact-manager.ts
│   └── output-renderer.ts
├── package.json
└── README.md
```

## Monorepo → Publishable Package Changes

### CLI package.json changes

```json
{
  "name": "aos-harness",
  "version": "0.1.0",
  "description": "Agentic Orchestration System — assemble AI agents into deliberation and execution teams",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aos-engineer/aos-harness.git"
  },
  "homepage": "https://aos.engineer",
  "keywords": ["ai", "agents", "orchestration", "multi-agent", "deliberation", "execution", "llm", "bun"],
  "type": "module",
  "bin": { "aos": "./src/index.ts" },
  "engines": { "bun": ">=1.0.0" },
  "files": ["src/", "core/", "README.md"],
  "dependencies": {
    "@aos-harness/runtime": "0.1.0",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "typescript": "^5.8.0"
  }
}
```

Key changes from current state:
- `name`: `@aos-harness/cli` → `aos-harness` (unscoped for easy install)
- `engines`: added `{ "bun": ">=1.0.0" }`
- `files`: added `core/` (bundled configs)
- `dependencies`: `workspace:*` → pinned version `"0.1.0"`

### Runtime package.json changes

```json
{
  "name": "@aos-harness/runtime",
  "version": "0.1.0",
  "engines": { "bun": ">=1.0.0" }
}
```

Only addition is the `engines` field. Everything else stays as-is.

### Root package.json

Stays `"private": true`. Never published.

## Core Config Bundling

**Problem:** The `core/` directory lives at the monorepo root. The CLI package needs it included when published to npm.

**Solution:** `prepublishOnly` script copies `../core` into `cli/core/` before publish. `cli/.gitignore` excludes `core/` so the copy isn't committed to git.

**prepublishOnly script** (in cli/package.json):

```json
{
  "scripts": {
    "prepublishOnly": "cp -r ../core ./core"
  }
}
```

**Cleanup:** The publish script (scripts/publish.ts) removes `cli/core/` after publishing.

**Git ignore:** Add `core/` to `cli/.gitignore` so the prepublish copy is never committed. The canonical `core/` stays at the monorepo root.

## Workspace Dependency Resolution

**Problem:** npm registries don't understand `workspace:*`.

**Solution:** The publish script (`scripts/publish.ts`) replaces `workspace:*` with the pinned version before publishing, then restores it afterward.

**Flow:**
1. Read `cli/package.json`
2. Replace `"@aos-harness/runtime": "workspace:*"` with `"@aos-harness/runtime": "0.1.0"`
3. Copy `core/` into `cli/core/`
4. Run `bun publish --access public` in `cli/`
5. Restore `workspace:*` in `cli/package.json`
6. Remove `cli/core/`

## First-Run Wizard

**Trigger:** User runs `aos` or `bunx aos-harness` with no arguments in a directory where no AOS project is detected (no `core/agents/` or `.aos/` in current or parent directories).

**Flow:**

```
$ bunx aos-harness

  AOS Harness v0.1.0

  No AOS project detected in this directory.
  Would you like to initialize one? (Y/n)

  > Y

  Copying core configs (13 agents, 6 profiles, 5 domains)... done.
  Created .aos/ directory.

  Your AOS project is ready. Next steps:

    aos run strategic-council --brief <your-brief.md>
    aos list
    aos create agent <name>
    aos validate
```

**Implementation:** In `cli/src/index.ts`, before the command switch:

1. Command provided? Proceed normally.
2. No command, no project detected? Prompt for init.
3. No command, project exists? Print help.

**Config resolution change:** `aos init` currently copies configs from the repo's `core/` directory (found via `getHarnessRoot()`). After npm install, `core/` lives inside the installed package. The `init` command resolves `core/` from `import.meta.dir` (the package's install location) as a fallback when the working directory doesn't contain a `core/` directory.

Resolution order:
1. Working directory `core/` (development — monorepo)
2. Package directory `core/` (production — npm install)

## Publishing Workflow

### Publish order

1. `@aos-harness/runtime` first (dependency)
2. `aos-harness` second (depends on runtime)

### Commands

```bash
# Dry-run (default — tests, validates, shows what would publish)
bun run scripts/publish.ts

# Publish for real
bun run scripts/publish.ts --confirm
```

### Updated publish script flow

1. Run unit tests (347 tests)
2. Run integration validation
3. Publish `@aos-harness/runtime` with `bun publish --access public`
4. For `aos-harness` (CLI):
   a. Copy `../core` into `cli/core/`
   b. Replace `workspace:*` with pinned version in `cli/package.json`
   c. `bun publish --access public`
   d. Restore `workspace:*` in `cli/package.json`
   e. Remove `cli/core/`

### Version strategy

Both packages share the same version number. Bump both when releasing. No version matrix.

## Documentation Updates

### README.md (root)

Update Quick Start from "git clone" to:

```markdown
### Prerequisites
- [Bun](https://bun.sh) 1.0+

### Install
bun add -g aos-harness

### Initialize
cd your-project
aos init

### Run
aos run strategic-council --brief brief.md
```

### cli/README.md (new — npm page)

Concise README for npmjs.com:
- One-liner description
- Install command
- Quick start (init, run, list)
- Link to full docs at aos.engineer
- Link to GitHub repo

### docs/getting-started/README.md

Replace "clone the repo" instructions with `bun add -g aos-harness`.

### Astro site getting-started page

Match the updated docs.

## Non-Goals

- **Node.js compatibility** — Bun is a hard requirement. No compilation, no polyfills.
- **Adapter publishing** — Pi, Claude Code, Gemini adapters stay in the repo but are not published to npm. They require platform-specific runtimes.
- **Monorepo restructuring** — The workspace layout stays the same. Only package.json metadata and the publish script change.
- **Bundling** — No esbuild, rollup, or tsup. TypeScript source is the artifact.

## Dependencies

- npm account with access to publish `aos-harness` and `@aos-harness` scope
- Both package names must be available on npm (verify before starting)
