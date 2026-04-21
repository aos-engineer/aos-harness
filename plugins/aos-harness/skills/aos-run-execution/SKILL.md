---
name: aos-run-execution
description: Run AOS execution profiles such as `cto-execution` through the local CLI wrapper.
metadata:
  short-description: Run AOS execution profiles
---

# AOS Run Execution

Use this skill when the user wants an execution package rather than a deliberation memo.

## Prerequisites

- You must be inside the `aos-framework` git repository, or set `AOS_HARNESS_ROOT` to that repo root.
- `bun` must be installed and available on `PATH`.

Resolve the wrapper path before running commands. Prefer the shared home-local install when present:

```bash
if [ -x "$HOME/plugins/aos-harness/scripts/aos_cli.sh" ]; then
  AOS_WRAPPER="$HOME/plugins/aos-harness/scripts/aos_cli.sh"
else
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  export AOS_HARNESS_ROOT="${AOS_HARNESS_ROOT:-$REPO_ROOT}"
  AOS_WRAPPER="$REPO_ROOT/plugins/aos-harness/scripts/aos_cli.sh"
fi
```

## Required Inputs

- `profile`: required execution profile, currently `cto-execution`
- `brief`: required brief path
- `workflow-dir`: optional override for non-default workflow locations

## Workflow

1. Confirm that the requested profile is an execution profile.
2. Confirm the brief path exists before launching.
3. Run the wrapper command with the profile and brief.
4. Summarize the result and point the user to the generated output path when available.

## Commands

Sample execution run:

```bash
"$AOS_WRAPPER" run cto-execution --brief core/briefs/sample-cto-execution/brief.md
```

With a workflow override:

```bash
"$AOS_WRAPPER" run cto-execution --brief path/to/brief.md --workflow-dir core/workflows
```

## Guardrails

- Execution profiles may prompt for review gates during a real run. Do not claim the flow is fully non-interactive.
- Keep execution local to this repository. Do not switch to the Pi adapter unless the user explicitly asks for that workflow.
- If the user only wants to validate configuration, use the deliberation skill with `--dry-run` or the validate skill instead.
