# Changelog

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
