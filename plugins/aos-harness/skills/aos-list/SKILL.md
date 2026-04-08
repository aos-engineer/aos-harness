---
name: aos-list
description: List available AOS agents, profiles, domains, skills, and briefs through the local CLI wrapper.
metadata:
  short-description: List AOS resources
---

# AOS List

Use this skill when the user wants to inspect what the harness currently ships with.

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
"$AOS_WRAPPER" list
```

## Workflow

1. Run the list command.
2. Summarize the available agents, profiles, domains, skills, and briefs that matter to the user’s request.
3. Recommend a next step when useful, such as `run`, `create`, or `validate`.

## Guardrails

- Keep the output faithful to the CLI instead of inventing resources.
- Use this skill to build context before suggesting profile or domain choices.
