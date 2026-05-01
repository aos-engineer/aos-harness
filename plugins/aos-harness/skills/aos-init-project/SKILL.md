---
name: aos-init-project
description: Initialize AOS Harness in the current project by creating `.aos/config.yaml` through the local CLI wrapper.
metadata:
  short-description: Initialize AOS in a project
---

# AOS Init Project

Use this skill when the user wants to initialize AOS in the current project with `aos init`.

## Prerequisites

- You must be inside the `aos-harness` git repository, or set `AOS_HARNESS_ROOT` to that repo root.
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

## Required Workflow

1. Check whether `.aos/config.yaml` already exists in the target project.
2. If it exists, do not reinitialize unless the user explicitly asks to replace it.
3. Choose the adapter:
   - default to `pi`
   - allow `claude-code` or `gemini` when the user asks
4. Run the wrapper command.
5. Report the config path that was created or confirm that initialization was already present.

## Commands

Default initialization:

```bash
"$AOS_WRAPPER" init --adapter pi
```

Alternative adapters:

```bash
"$AOS_WRAPPER" init --adapter claude-code
"$AOS_WRAPPER" init --adapter gemini
```

## Guardrails

- Do not remove `.aos/` to force a reinit unless the user explicitly asks for that destructive change.
- Keep execution repo-local. Do not assume a globally installed `aos` binary.
- If neither the home-local wrapper nor the repo-local wrapper exists, stop and explain that the AOS host bundle is not installed.
