---
name: aos-replay
description: Replay AOS transcript files through the local CLI wrapper.
metadata:
  short-description: Replay AOS sessions
---

# AOS Replay

Use this skill when the user wants to inspect or replay a previous AOS session transcript.

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

## Required Input

- `transcript`: path to a `.jsonl` transcript file, usually under `.aos/sessions/` or `output/`

## Command

```bash
"$AOS_WRAPPER" replay path/to/transcript.jsonl
```

## Workflow

1. Confirm the transcript path exists.
2. Run the replay command through the wrapper.
3. Summarize the replayed session or point the user to the relevant output if they asked for a specific detail.

## Guardrails

- Do not guess transcript paths. Verify them before running the command.
- Keep the command repo-local through the wrapper.
