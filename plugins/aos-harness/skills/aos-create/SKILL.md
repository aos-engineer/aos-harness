---
name: aos-create
description: Scaffold new AOS agents, profiles, domains, and skills through the local CLI wrapper.
metadata:
  short-description: Scaffold AOS resources
---

# AOS Create

Use this skill when the user wants to scaffold a new AOS resource with the harness’s built-in templates.

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

## Supported Resource Types

- `agent`
- `profile`
- `domain`
- `skill`

For **briefs**, use the `aos-create-brief` skill — it conducts a guided
conversation rather than scaffolding from a template.

## Workflow

1. Normalize the requested name to kebab-case when needed.
2. Choose one supported resource type.
3. Run the wrapper command.
4. Report the created path and remind the user to fill in scaffold TODOs.

## Commands

Create an agent:

```bash
"$AOS_WRAPPER" create agent risk-analyst
```

Create a profile:

```bash
"$AOS_WRAPPER" create profile security-review-plus
```

Create a domain:

```bash
"$AOS_WRAPPER" create domain logistics
```

Create a skill:

```bash
"$AOS_WRAPPER" create skill dependency-analysis
```

## Guardrails

- Only use the supported resource types.
- Do not overwrite existing scaffolds unless the user explicitly asks for replacement behavior.
- Keep the command repo-local through the wrapper.
