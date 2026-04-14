# Changelog

## 0.7.0 — Adapter Trust Model (security)

### Breaking

- **Adapter source inside a cloned repo is no longer loaded.** The CLI resolves adapters only from installed `@aos-harness/<name>-adapter` packages or the monorepo dev layout (from the CLI's own install location). A project-local `adapters/<name>/` directory is ignored. Adapter authors should use `npm link @aos-harness/my-adapter`.
- **`executeCode` is denied by default.** Profiles that use code execution must add:
  ```yaml
  tools:
    execute_code:
      enabled: true
      languages: [python, bash]
      max_timeout_ms: 60000
  ```
- **Unknown adapter names exit 2.** The CLI now allowlists `pi`, `claude-code`, `codex`, `gemini`.
- **New exit code 3:** profile tool-policy validation failures and CLI flag attempting to widen profile.

### Added

- `--allow-code-execution[=<langs>|none]` flag to narrow (never widen) the profile's code-execution allowlist for a single session.
- Tool-denied events appended to `transcript.jsonl` for audit.
- `BaseWorkflow.listEnabledTools()` read-only API.
- `validatePlatformUrl` rejects non-https (except loopback), link-local, and metadata addresses.

### Migration

See `docs/security/profile-tools-migration.md` (new).

### Release infrastructure

- Packages are now published from GitHub Actions via an environment-gated release workflow. Consumers can verify the registry's built-in signature with `npm audit signatures` after install. (Provenance attestations require a public source repo; since this repo is private, the release intentionally does not emit them. Trust is instead anchored on the tag-triggered, reviewer-approved CI publish path.)
- Local `publish:all` is replaced by `publish:dry-run` (pack-only, no upload). Publishing from a laptop is no longer supported; use `git tag -a v<version>` + push.
- YAML-safety lint is now AST-based (`scripts/check-yaml-safety.ts`). The previous grep-based version is removed.
- `scripts/copy-core.ts` refuses symlink targets and paths outside `cli/core`.
- CI workflow gained a minimum `permissions: { contents: read }` block.

See `docs/security/npm-release-runbook.md` for the release process.

## [0.6.0] - 2026-04-14

### Breaking

- **`aos-harness` no longer bundles adapter code.** You must install the adapter(s) you use as separate packages. If you run `aos run` without the matching `@aos-harness/<name>-adapter` installed, the CLI now exits with code `2` and prints both the global and project-local install commands. The bundled fallback path that 0.5.x used has been removed, along with the deprecation warning that 0.5.2 printed when it was hit.
- **CLI tarball no longer ships `adapters/`.** The `files` field in `cli/package.json` is now `["src/", "core/", "README.md"]`.

### Added

- Adapters declared as optional peer dependencies on the CLI, range `">=0.6.0 <1.0.0"`. `peerDependenciesMeta.*.optional = true` so `npm i -g aos-harness` continues to succeed with no peers installed.
- Runtime version-mismatch warning when the CLI's major or minor version differs from the loaded adapter's. Patch-level drift is silent. Fires once per package per session.
- `aos init` prints the adapter install commands at the end (Claude Code, Gemini, Codex, Pi — all four).
- `aos init --adapter` now accepts `codex` in addition to `pi`, `claude-code`, `gemini`.

### Migration

1. Upgrade the CLI: `npm i -g aos-harness@0.6.0`
2. Install the adapter(s) you were relying on:
   ```bash
   npm i -g @aos-harness/claude-code-adapter@0.6.0
   npm i -g @aos-harness/gemini-adapter@0.6.0
   npm i -g @aos-harness/codex-adapter@0.6.0
   npm i -g @aos-harness/pi-adapter@0.6.0
   ```
3. Re-run `aos run`. No other changes required.

## [0.5.2] - 2026-04-14

### Deprecated

- **Bundled adapters will be removed in 0.6.0.** When `aos run` falls back to the bundled copy of an adapter (i.e., the standalone `@aos-harness/<name>-adapter` package is not installed), the CLI now prints a one-time yellow deprecation warning per project with the install command needed to prepare for 0.6.0. The flag file `.aos/migration-warned-0.6` records that the warning was shown; delete it to re-enable. The warning is also deduped within a single process so multi-adapter runs don't double-warn.

### Unchanged

- Bundled adapter loading still works exactly as before. 0.5.2 is purely additive — no runtime behavior changes beyond the warning.

## [0.5.1] - 2026-04-14

### Fixed

- `aos-harness` CLI tarball dropped from ~39 MB to ~220 KB. `scripts/copy-core.ts` now filters out `node_modules/`, lockfiles, `.aos/` session data, and test directories when bundling adapters into the CLI. Users installing the CLI no longer pull ~15k transitive files from bundled adapters' dev dependencies.

## [0.5.0] - 2026-04-13

### Added

- Standalone npm distribution for all four adapters: `@aos-harness/claude-code-adapter`, `@aos-harness/codex-adapter`, `@aos-harness/gemini-adapter`, `@aos-harness/pi-adapter`. Hybrid model — adapters are still bundled inside the `aos-harness` CLI for zero-install UX.
- `[adapter]` log line at adapter load time showing package name, version, and whether the adapter was resolved standalone or from the CLI's bundled copy.

### Changed

- Lockstep versioning across the seven published packages. `scripts/publish.ts` now enforces a single `releaseVersion` across `runtime`, `adapter-shared`, the four adapters, and the CLI.
- `scripts/publish.ts` refactored to a single loop with a `publishWithPinnedDeps` helper. Idempotent: re-running after a partial publish skips packages already on the registry.
- Every adapter `package.json` now declares `description`, `license`, `repository.directory`, `homepage`, `keywords`, `engines.bun`, `files`, and `publishConfig.access`.

## [0.1.0] - 2026-03-24

### Added

**Core Framework**
- 13 agent personas with distinct cognitive biases (Arbiter, CTO Orchestrator, Catalyst, Sentinel, Architect, Provocateur, Navigator, Advocate, Pathfinder, Strategist, Operator, Steward, Auditor)
- 6 orchestration profiles (strategic-council, cto-execution, security-review, delivery-ops, architecture-review, incident-response)
- 5 domain knowledge packs (SaaS, healthcare, fintech, platform-engineering, personal-decisions)
- 7 workflow definitions (brainstorm, plan, execute, review, debug, verify, cto-execution)
- JSON Schema validation for all config types (agent, profile, domain, workflow, artifact, skill)

**Execution Profiles**
- Delegation pattern: CTO orchestrator drives 8-step workflow with 3 review gates
- Artifact system: inter-step work product passing with manifest tracking, revision management
- 4 workflow action types: targeted-delegation, tension-pair, orchestrator-synthesis, execute-with-tools
- DelegationDelegate interface: workflow runner calls real engine delegation
- Execution package output renderer with YAML frontmatter
- Agent capabilities declarations (can_execute_code, can_produce_files, available_skills)
- `role_override` for shifting agents from advisory to production mode
- `retry_with_feedback` gate behavior with feedback injection loop

**Skill Awareness (Layer 3)**
- `aos/skill/v1` schema for skill manifests
- 3 example skill definitions: code-review, security-scan, task-decomposition
- `loadSkill()` in config-loader with schema validation

**Runtime Engine**
- Constraint engine (time, budget, rounds with conflict resolution)
- Delegation router (broadcast, targeted, tension-pair with bias enforcement)
- Template resolver with optional variable line stripping
- Domain merger (append-only overlay semantics)
- Workflow runner with transcript event emission (10 event types)
- Budget estimation with auth-mode awareness

**Platform Adapters**
- Pi CLI adapter: full 4-layer implementation (agent runtime, event bus, UI, workflow engine)
- Pi adapter execution methods: executeCode (sandboxed subprocess), invokeSkill (skill manifest loading), createArtifact, loadArtifact, submitForReview
- Claude Code adapter: static artifact generator with execution profile awareness

**CLI**
- `aos init` — initialize project
- `aos run [profile]` — run deliberation or execution sessions
- `aos create agent|profile|domain|skill` — scaffold configs
- `aos validate` — validate all configs including skills and cross-references
- `aos list` — list agents, profiles, domains, skills with type indicators
- `aos replay` — replay session transcripts
- `--verbose`, `--dry-run`, `--domain`, `--brief`, `--workflow-dir` flags

**Security**
- Safe YAML deserialization (JSON_SCHEMA on all yaml.load calls)
- Artifact ID validation (path traversal prevention)
- Editor allowlist for openInEditor
- Sandbox enforcement for code execution (strict/relaxed modes)
- Prompt/code separation in execute-with-tools
- CI lint rule for unsafe yaml.load detection
- Subprocess environment allowlisting

**Testing**
- 194 tests across 12 test files, 504 assertions
- Unit tests for all runtime modules
- Integration tests for CTO execution profile
- End-to-end workflow test with mock delegation
- Security regression tests

**Documentation**
- Framework design specification
- Execution profiles spec suite (4 documents)
- Getting started guide
- Creating agents, profiles, domains guides
- Sample briefs for strategic-council and cto-execution

**CI/CD**
- GitHub Actions workflow: test, typecheck, YAML safety lint, config validation
