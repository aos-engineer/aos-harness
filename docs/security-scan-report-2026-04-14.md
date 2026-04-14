# Security Scan Report — aos-framework

**Date:** 2026-04-14
**Scanner Version:** appsec-scanner v1.0 (scoped pass)
**Project:** Bun/TypeScript monorepo — CLI + adapters + npm publish pipeline
**Scope:** `cli/`, `adapters/`, `scripts/`, workspace `package.json` files, `.github/workflows/`, `docker-compose.yml`. DAST skipped (no running instance).
**Focus:** adapter loading, publish/lockstep release, secret handling, prompt-injection surfaces.

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 2 |
| Moderate | 4 |
| Low      | 6 |
| Info     | 3 |

**Overall Security Posture:** HIGH

Two **High** findings share a single root cause: the CLI resolves an adapter name sourced from workspace `.aos/config.yaml` / `--adapter` without an allowlist, then prefers project-local adapter source over the bundled implementation. Cloning a hostile repo and running `aos run` is sufficient for RCE in the user's shell context — a classic workspace-trust gap. Four **Moderate** findings cluster around publish-pipeline integrity (no `--provenance`, lint/typecheck not gated on `publish:all`, publish runs locally outside CI, YAML-safety lint uses bypassable grep). No hardcoded secrets, no `postinstall` lifecycle hooks, bridge uses a Unix domain socket (not TCP).

## Findings

### RCE-001: Workspace-trust RCE via adapter name / project-local adapter source
- **Severity:** High (CVSS 7.8 — AV:L/AC:L/PR:L/UI:R/S:U/C:H/I:H/A:H)
- **CWE:** CWE-829 Inclusion of Functionality from Untrusted Control Sphere / CWE-94
- **Confidence:** confirmed
- **Affected Files:** `cli/src/commands/run.ts:322-328, 366`; `cli/src/adapter-session.ts:85-87`; `cli/src/utils.ts:125-136`

**Description:** `adapter` is read from `.aos/config.yaml` or `--adapter` and passed unvalidated into `join(root, "adapters", adapterName, "src", "index.ts")`. The resolver **prefers the project-local path over the bundled adapter**, and then either `Bun.spawn(["pi", "-e", adapterEntry])` executes it or `await import(fallback)` loads it. A hostile repo with `adapters/pi/src/index.ts` containing arbitrary code gets full execution on `aos run`. Also enables path traversal (`--adapter ../../evil`) since no base-dir confinement (`resolve(base, x).startsWith(base + sep)`) is applied. `init.ts` already has a `VALID_ADAPTERS` allowlist — `run.ts` does not.

**Evidence:**
```ts
// cli/src/commands/run.ts
if (args.flags["adapter"]) adapter = args.flags["adapter"] as string;
const adapterName = adapter === "claude-code" ? "claude-code" : adapter;
const resolvedAdapterDir = existsSync(join(root, "adapters", adapterName, "src", "index.ts"))
  ? join(root, "adapters", adapterName)
  : getAdapterDir(adapterName);
```

**Remediation:**
1. Allowlist `adapter` against `["pi","claude-code","gemini","codex"]` immediately after reading config/flag (reuse `VALID_ADAPTERS`).
2. Default to bundled `getAdapterDir(adapterName)`; require explicit opt-in (`aos trust` / env var / first-use prompt) before loading project-local adapter code.
3. After `resolve(...)`, assert `resolvedAdapterDir.startsWith(expectedBase + sep)`.

---

### RCE-002: `executeCode` runs shell/python/node/bun with no access gate
- **Severity:** High (CVSS 7.3 when reachable via agent output)
- **CWE:** CWE-94 / CWE-78
- **Confidence:** likely (feature-by-design, but gate is stubbed)
- **Affected Files:** `adapters/shared/src/base-workflow.ts:229-325, 386-391`

**Description:** `executeCode` executes arbitrary strings via `bash -c`, `bun eval`, `python3 -c`, `node -e`. `enforceToolAccess` returns `{ allowed: true }` unconditionally. If any agent/adapter path can reach `executeCode` with attacker-influenced content (prompt injection in an LLM response), this is RCE on the user's workstation.

**Remediation:** Default-deny in `enforceToolAccess`; require per-profile allowlist; require an explicit `--dangerously-allow-code-execution` CLI flag; optionally wrap execution in `bwrap` / `firejail` / `nsjail`.

---

### SUPPLY-001: `publish:all` bypasses lint + typecheck gate
- **Severity:** Moderate (CVSS 5.3)
- **CWE:** CWE-1357
- **Affected Files:** `package.json`, `scripts/publish.ts`

**Description:** `prerelease` runs `lint && test`, but npm only auto-invokes `pre<script>` hooks for built-in lifecycles, not for `publish:all`. `publish.ts` runs tests + integration validation but never executes `bun run lint` (which is `check-yaml-safety.sh` + `typecheck`). Type errors and unsafe YAML loads can ship.

**Remediation:** In `publish.ts` `main()`, run `await $\`bun run lint\`.cwd(root)` before tests — or rename `publish:all` → `publish` so `prerelease` fires.

---

### SUPPLY-002: No `--provenance`, no signed-tag verification on publish
- **Severity:** Moderate (CVSS 6.1)
- **CWE:** CWE-1357
- **Affected Files:** `scripts/publish.ts:110`

**Description:** `bun publish --access public` — no `--provenance` flag, no assertion that HEAD is at a signed `v${releaseVersion}` tag, no `git status --porcelain` clean-tree check. Anyone with the NPM token can publish any local state.

**Remediation:** Enforce clean worktree + signed tag match before publish; add `--provenance` (requires publishing from GitHub Actions with `id-token: write`).

---

### SUPPLY-003: Publish runs on developer machine, not CI
- **Severity:** Moderate (CVSS 5.9)
- **CWE:** CWE-1357
- **Affected Files:** `.github/workflows/` (only `ci.yml` present)

**Description:** No tag-triggered release workflow. `NPM_TOKEN` lives on a developer laptop with no environment protection, no required reviewers, no audit trail, and provenance cannot be attested.

**Remediation:** Add `.github/workflows/release.yml` triggered on `v*` tag push, `environment: npm-publish` with required reviewers, `permissions: { contents: read, id-token: write }`, `npm publish --provenance`.

---

### SUPPLY-006: `check-yaml-safety.sh` uses trivially bypassable grep
- **Severity:** Moderate (CVSS 5.3)
- **CWE:** CWE-807
- **Affected Files:** `scripts/check-yaml-safety.sh`

**Description:** `grep -rn 'yaml\.load(' | grep -v 'JSON_SCHEMA' | grep -v 'test'` bypasses:
- `const { load } = yaml; load(x)` — destructured import not matched
- `yaml . load(` — whitespace variants missed
- Any path containing `test` (including `latest-config.ts`) gets a free pass
- `JSON_SCHEMA` anywhere on the line (even in a comment) satisfies the check
- Only scans `runtime/src/` + `adapters/` — `cli/`, `core/` unchecked

**Remediation:** Replace with ts-morph / ESLint AST rule that inspects the second argument of actual `yaml.load` call expressions; scope exclusions to `**/tests/**` / `**/*.test.ts`.

---

### PATH-002: `--workflow-dir`, `--brief`, `replay <path>` not confined to project root
- **Severity:** Low (CVSS 3.3)
- **CWE:** CWE-22
- **Affected Files:** `cli/src/commands/run.ts:153-196`, `cli/src/commands/replay.ts:166-178`

**Description:** Paths resolve via `resolve(process.cwd(), x)` or accept absolute paths as-is, then `readFileSync` them. Low direct impact (user is reading their own files), but if the value ever flows from `.aos/config.yaml` or an adapter response, arbitrary-file-read → LLM exfiltration vector opens.

**Remediation:** For values sourced from config/adapter output (not direct user CLI args), confine via `resolve(root, x).startsWith(root + sep)`.

---

### PATH-003: `aos create <type> <name>` does not sanitize `.` / `/` in name
- **Severity:** Low (CVSS 3.1)
- **CWE:** CWE-22
- **Affected Files:** `cli/src/commands/create.ts:379-471`, `cli/src/utils.ts:59-64`

**Description:** `toKebabCase` lowercases and replaces `[\s_]` only. `aos create agent ../../evil` writes `agent.yaml` + `prompt.md` outside `core/agents/custom/`.

**Remediation:** Validate sanitized name against `/^[a-z0-9][a-z0-9-]*$/` before join.

---

### NET-002: `platformUrl` outbound fetch not validated
- **Severity:** Low (CVSS 3.1)
- **CWE:** CWE-918
- **Affected Files:** `cli/src/commands/run.ts:13-32, 310-320`

**Description:** `platformUrl` from `--platform-url` or `.aos/config.yaml` is concatenated into `fetch(…)` with no scheme allowlist, no internal-IP blocklist (`127.0.0.1`, `169.254.169.254`, RFC1918), no `file://` rejection. Failures swallowed silently. If config is shared from untrusted source or generated by LLM, enables transcript exfiltration or blind internal probing.

**Remediation:** `new URL()` parse + enforce `https:` scheme; reject loopback / link-local / RFC1918 unless `--dev` flag; consider env-based allowlist.

---

### SUPPLY-005: `rmSync(..., { recursive: true })` unconditionally on `cli/core`
- **Severity:** Low (CVSS 3.3)
- **CWE:** CWE-22
- **Affected Files:** `scripts/copy-core.ts:21-33`

**Description:** If `cli/core` ever becomes a symlink (attacker with repo write), recursive delete traverses. Paths themselves are hard-coded (not config-driven), so only a local-attacker-with-repo-write scenario.

**Remediation:** `lstatSync` + symlink check before `rmSync`; or refuse to delete symlinks.

---

### SUPPLY-007: `pinWorkspaceDeps` leaves tree dirty on SIGKILL
- **Severity:** Low (CVSS 3.7)
- **CWE:** CWE-691
- **Affected Files:** `scripts/publish.ts:56-63, 75-127`

**Description:** `try/finally` restores originals, but SIGKILL between write and finally leaves pinned versions committed-ready. Developer could accidentally commit `"0.5.0"` instead of `"workspace:*"`.

**Remediation:** Operate on temp pack directory rather than mutating source tree.

---

### SUPPLY-004: `cli/package.json` missing `publishConfig` for provenance
- **Severity:** Low (CVSS 3.1)
- **CWE:** CWE-200
- **Affected Files:** `cli/package.json`

**Description:** `cli/package.json` declares `bin` but has no `publishConfig`. Root `package.json` has no `files` field but is `private: true` (mitigated). Add `"publishConfig": { "access": "public", "provenance": true }` to all seven published packages.

---

### SECRET-001: CI workflow missing top-level `permissions` block
- **Severity:** Low (CVSS 3.3)
- **CWE:** CWE-732
- **Affected Files:** `.github/workflows/ci.yml`

**Description:** No `permissions:` block — defaults apply (org/repo-dependent, can be write). Mitigated by `pull_request` (not `pull_request_target`) trigger, so no secret exposure, but hardening gap.

**Remediation:** Add `permissions: { contents: read }` at top level.

---

### RCE-003 / NET-001 / SUPPLY-008 / SUPPLY-010: Informational

- **RCE-003 (Info):** `cli/src/adapter-session.ts` has an `ADAPTER_MAP` allowlist — good pattern; extend it to `run.ts` (see RCE-001).
- **NET-001 (Info):** Bridge server uses Unix domain socket (not TCP) — no network exposure; auth/rate-limit not required for UDS. If transport ever changes to TCP, add bearer token + bind to `127.0.0.1`.
- **SUPPLY-008 (Info):** NPM token handling is clean — never read, logged, or printed.
- **SUPPLY-010 (Info):** All 7 published packages declare `files:` field correctly; root is `private`.

## Remediation Priority

1. **RCE-001** — allowlist `adapter` in `run.ts`; require opt-in for project-local adapter source. Single-file fix, eliminates both High findings' primary vector.
2. **RCE-002** — implement `enforceToolAccess` denylist-by-default in `base-workflow.ts`; add `--dangerously-allow-code-execution` flag.
3. **SUPPLY-001** — add `bun run lint` to `publish.ts` main(). One line.
4. **SUPPLY-002 + SUPPLY-003** — add `.github/workflows/release.yml` with provenance + environment approval; remove local publish path.
5. **SUPPLY-006** — replace `check-yaml-safety.sh` with AST-based ESLint rule.
6. **PATH-002 / PATH-003 / NET-002** — add path confinement + URL validation helpers.
7. **SUPPLY-005 / SUPPLY-007 / SUPPLY-004 / SECRET-001** — defense-in-depth polish.

## Positive Security Controls Observed

- `ADAPTER_MAP` allowlist in `adapter-session.ts` correctly gates non-pi dynamic `import()`.
- `BaseWorkflow.validatePath` correctly confines filesystem ops to `projectRoot`.
- Bridge server uses Unix domain socket (not TCP) — no network exposure.
- No hardcoded secrets anywhere in scope; `.gitignore` correctly excludes `.env*`.
- NPM publish token handling is clean — never logged or interpolated.
- All published packages declare `files:` whitelist; no `postinstall` / `prepare` lifecycle scripts (no consumer-install RCE).
- YAML parsed with `JSON_SCHEMA` throughout (blocks `!!js/function` code-object tags).
- Base agent runtime uses `spawn(..., { shell: false })` with argv array — no shell interpolation.
- Init command already enforces `VALID_ADAPTERS` allowlist (pattern to propagate).
- `pull_request` (not `pull_request_target`) in CI — safe default for untrusted PR code.

## What Was Checked

| # | Pattern | Checked | Findings |
|---|---------|---------|----------|
| 1 | Broken Auth via Headers | N/A — local CLI, no HTTP auth | — |
| 2 | Path Traversal | Yes | 3 (PATH-001 rolled into RCE-001; PATH-002, PATH-003) |
| 3 | RCE / Code Injection | Yes | 3 (RCE-001, RCE-002, RCE-003 info) |
| 4 | SSRF | Yes | 1 (NET-002) |
| 5 | Sensitive Data Exposure | Yes | 1 (SECRET-001) |
| 6 | Network Segmentation | Yes | Clean (Unix socket) |
| 7 | Content Injection | Not in scope (no frontend rendering surface) | — |
| 8 | Container Privileges | Not in scope (dev CLI, no prod containers) | — |
| 9 | Broken Access Control | N/A — local CLI | — |
| + | Supply Chain / Publish | Yes | 7 (SUPPLY-001…007; 008/010 info) |
