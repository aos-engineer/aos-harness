# Opt-In Adapters (0.6.0) Design

**Date:** 2026-04-14
**Status:** Draft
**Scope:** Stop bundling adapters inside the `aos-harness` CLI. Users install only the adapter(s) they actually use.

## Goal

Make `aos-harness` adapter-agnostic. On `aos run`, the CLI resolves the requested adapter from the user's node_modules. If it's not installed, the CLI prints a clear, copy-pasteable install command and exits non-zero. No bundled fallback.

## Why

- In 0.5.1 every CLI install still ships source for all 4 adapters (~100 KB of TS the user may never touch). Small today, unbounded tomorrow — new adapters would grow the CLI by design.
- The hybrid model forces adapter release cadence to track the CLI. Decoupling means an adapter can ship a patch without dragging the CLI through a release.
- "What version of the claude-code adapter am I running?" is ambiguous today (bundled copy vs. globally installed vs. project-local). Opt-in collapses it to one answer: whatever the user installed.

## Non-Goals

- Changing adapter APIs or the composition layer (`composeAdapter`) — purely distribution.
- Auto-installing adapters. We tell the user what to run, we don't run it for them.
- Plugin discovery (scanning for `@aos-harness/*-adapter` in scope). Deferred to 0.7.0+ if demand appears.

## Decisions

### Distribution

- **CLI ships no adapter code.** `scripts/copy-core.ts` stops copying `adapters/` into `cli/`. The `cli/adapters/` path disappears from the published tarball.
- **Adapters are peer dependencies** of the CLI, marked `peerDependenciesMeta.*.optional = true` so `npm i -g aos-harness` doesn't error. Users who want one install it explicitly: `npm i -g @aos-harness/claude-code-adapter`.
- **`core/` still bundles** — it's the framework's data (agents, profiles, domains, schemas), not pluggable runtime code.

### Resolution

- `loadAdapterRuntime(platform)` keeps its current first branch (`import(entry.package)`). The bundled-fallback branch is removed.
- When the import fails with `MODULE_NOT_FOUND` / `ERR_MODULE_NOT_FOUND`, the CLI prints:
  ```
  ✗ Adapter not installed: @aos-harness/claude-code-adapter
    Install it:  npm i -g @aos-harness/claude-code-adapter
                 (or, if using a local install:  npm i @aos-harness/claude-code-adapter)
    Matching CLI version: aos-harness@<current>. Adapters are lockstep — install the same version.
  ```
  Exit code 2.
- Any other import error is re-thrown with the original stack — don't swallow genuine bugs inside an adapter as "not installed".

### Version alignment

- Publish script stays lockstep (the 0.5.0 design already handles this). The error message tells the user to match versions.
- On load, if the resolved adapter's version ≠ CLI's version, log a warning but don't refuse. Pre-1.0, strict matching is hostile; a warning is enough.

### Dev ergonomics

- In the repo, workspace symlinks mean `@aos-harness/claude-code-adapter` resolves without changes — dev UX unchanged.
- Remove `cli/adapters/` fully. The fallback path (`join(here, "..", "..", "adapters", platform, "src", "index.ts")`) is dead code post-change.
- `scripts/copy-core.ts` simplifies to `copyCore`/`cleanCore` for `core/` only. Rename to `copy-core-bundle.ts`? Out of scope — keep name.

## Changes

### 1. `cli/package.json`

```jsonc
{
  "peerDependencies": {
    "@aos-harness/claude-code-adapter": "0.6.x",
    "@aos-harness/codex-adapter": "0.6.x",
    "@aos-harness/gemini-adapter": "0.6.x",
    "@aos-harness/pi-adapter": "0.6.x"
  },
  "peerDependenciesMeta": {
    "@aos-harness/claude-code-adapter": { "optional": true },
    "@aos-harness/codex-adapter": { "optional": true },
    "@aos-harness/gemini-adapter": { "optional": true },
    "@aos-harness/pi-adapter": { "optional": true }
  },
  "files": ["src/", "core/", "README.md"]
}
```
Note: `adapters/` drops from `files`.

### 2. `scripts/copy-core.ts`

Remove the adapters block. Keep `core/` copy as-is.

### 3. `cli/src/adapter-session.ts`

Replace the try/catch fallback in `loadAdapterRuntime` with:
```ts
try {
  const mod = await import(entry.package);
  // ... existing version log ...
  return mod[entry.className];
} catch (err: any) {
  if (err?.code === "MODULE_NOT_FOUND" || err?.code === "ERR_MODULE_NOT_FOUND") {
    printMissingAdapterError(entry.package);
    process.exit(2);
  }
  throw err;
}
```
Add `printMissingAdapterError` that writes the formatted message to stderr.

### 4. CLI README

Add a **Getting Started** section that lists each adapter and its install command. The current README (if it mentions bundled behavior) needs updating — the CLI alone is no longer runnable.

### 5. Publish script

`scripts/publish.ts` loses the `prePublish: copyCore` call for the CLI… actually, `copyCore` still copies `core/`, so it stays. Just the adapter-copy lines inside `copyCore` go away.

## Migration / Rollout

This is a breaking change for anyone who installed `aos-harness` and relied on bundled adapters. So:

1. **0.5.x stays on the lockstep-hybrid model.** Users who don't upgrade get the current behavior.
2. **0.5.2 deprecation warning:** on every run, if the bundled fallback was used (i.e., the standalone adapter wasn't installed), log a warning: `bundled adapters are deprecated and will be removed in 0.6.0; install @aos-harness/<name>-adapter`.
3. **0.6.0** ships the changes above. Breaking: CLI alone won't run.
4. README + CHANGELOG call out the upgrade path prominently.

## Verification

1. `bun run test` passes.
2. `bun run publish:all` (dry-run) shows the CLI tarball excludes `adapters/`.
3. Fresh install in a scratch directory:
   - `npm i -g aos-harness@0.6.0` → succeeds, no warnings about missing peers.
   - `aos run --adapter claude-code ...` → prints the missing-adapter message, exits 2.
   - `npm i -g @aos-harness/claude-code-adapter@0.6.0` → then rerun → works.
4. Version mismatch check: install CLI 0.6.0, adapter 0.6.0; drop adapter to a hypothetical 0.5.1 locally → warning printed, run continues.

## Open Questions

1. **Global vs. project install.** The error message assumes global. If the CLI itself was installed globally, global adapters work. If the CLI was installed into a project, the user needs project-local adapters. Should the CLI detect its own install location and tailor the command? Probably yes — `require.resolve.paths` or `process.argv[1]` check. Deferrable to implementation.
2. **Windows support.** The error message uses `npm i`. Users running Bun or pnpm get slightly wrong guidance. Leave as-is (npm is universal) or sniff the user's package manager? Low priority.
3. **Should `adapter-shared` remain bundled?** It's not pluggable — it's a library the adapters depend on. Current answer: no, it's already pulled transitively by each standalone adapter, so no CLI bundling needed.

## Out of Scope / Future Work

- Plugin discovery (auto-find any `@aos-harness/*-adapter` in scope).
- An `aos adapter install <name>` convenience command that shells out to the user's package manager.
- Adapter registry / marketplace.
