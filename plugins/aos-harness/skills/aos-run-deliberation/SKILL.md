---
name: aos-run-deliberation
description: Run AOS deliberation profiles such as `strategic-council`, optionally with a domain and `--dry-run`, through the local CLI wrapper.
metadata:
  short-description: Run AOS deliberation profiles
---

# AOS Run Deliberation

Use this skill when the user wants to run a deliberation profile and get a memo-oriented result.

## Prerequisites

- You must be inside the `aos-harness` git repository.
- `bun` must be installed and available on `PATH`.

Resolve the wrapper path before running commands. Prefer the shared home-local install when present:

```bash
export AOS_HARNESS_ROOT="${AOS_HARNESS_ROOT:-/Users/jkolade/sireskay/github/aos-harness}"
if [ -x "$HOME/plugins/aos-harness/scripts/aos_cli.sh" ]; then
  AOS_WRAPPER="$HOME/plugins/aos-harness/scripts/aos_cli.sh"
else
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  AOS_WRAPPER="$REPO_ROOT/plugins/aos-harness/scripts/aos_cli.sh"
fi
```

## Required Inputs

- `profile`: required deliberation profile such as `strategic-council`, `incident-response`, `delivery-ops`, `architecture-review`, or `security-review`
- `brief`: brief path, usually under `core/briefs/` or a user-provided path
- `domain`: optional domain such as `saas`, `fintech`, `healthcare`, `platform-engineering`, or `personal-decisions`
- `dry-run`: optional, preferred when the user is exploring or validating setup

## Recommended Workflow

1. Confirm the brief path exists.
2. Prefer `--dry-run` when the user is exploring, validating, or troubleshooting.
3. Add `--domain <name>` only when requested or clearly useful.
4. Run the wrapper command and return the CLI output summary.

## Commands

Dry-run example:

```bash
"$AOS_WRAPPER" run strategic-council --brief core/briefs/sample-product-decision/brief.md --dry-run
```

Run with a domain:

```bash
"$AOS_WRAPPER" run strategic-council --brief core/briefs/sample-product-decision/brief.md --domain saas
```

Another deliberation profile:

```bash
"$AOS_WRAPPER" run security-review --brief path/to/brief.md --dry-run
```

## Guardrails

- Do not use this skill for execution profiles such as `cto-execution`; use `aos-run-execution` instead.
- Keep the command repo-local through the wrapper.
- If the user omits a brief, expect the CLI to prompt interactively; prefer passing `--brief` in automation and scripted runs.
