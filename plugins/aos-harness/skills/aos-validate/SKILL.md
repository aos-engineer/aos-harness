---
name: aos-validate
description: Run the AOS Harness validator through the local CLI wrapper and report both passing checks and known non-zero behavior faithfully.
metadata:
  short-description: Validate AOS configs
---

# AOS Validate

Use this skill when the user wants to validate agents, profiles, domains, skills, workflows, and brief compatibility.

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

## Command

```bash
"$AOS_WRAPPER" validate
```

## Required Workflow

1. Run the validator without suppressing its exit code.
2. Report failures exactly as they appear.
3. Call out the current known behavior: sample briefs are validated against every profile, so the command can exit non-zero even when the harness is otherwise healthy.

## Guardrails

- Do not rewrite the validator output to make the command look successful.
- Preserve the actual exit code and explain the known sample-brief mismatch when it appears.
- Keep the command repo-local through the wrapper.
