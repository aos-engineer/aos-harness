# Getting Started with AOS Harness

AOS Harness orchestrates specialized AI agents into structured deliberation and execution sessions. The fastest path to a working run is:

1. Install the `aos-harness` CLI
2. Ensure you already have a supported vendor CLI installed (`claude`, `codex`, `gemini`, or `pi`)
3. Install the matching AOS adapter package
4. Run `aos init`
5. Run `aos run`

## Prerequisites

- **Bun** (v1.0+): install from [bun.sh](https://bun.sh)
- **A supported vendor CLI** already installed and authenticated:
  - Claude Code CLI
  - Codex CLI
  - Gemini CLI
  - Pi CLI
- **A terminal** on macOS, Linux, or WSL

## Install

### 1. Install the CLI

```bash
npm i -g aos-harness
# or
bun add -g aos-harness
```

### 2. Install at least one adapter

Adapters are separate packages that augment the vendor CLI you already use:

```bash
npm i -g @aos-harness/claude-code-adapter
npm i -g @aos-harness/codex-adapter
npm i -g @aos-harness/gemini-adapter
npm i -g @aos-harness/pi-adapter
```

Versions publish lockstep with the CLI, so pin adapter and CLI versions together in CI or automated setup.

### 3. Initialize the project

```bash
cd your-project
aos init
```

`aos init` now:

- scans vendor CLI readiness
- scans AOS adapter-package readiness
- writes `.aos/config.yaml` in v2 format
- writes `.aos/memory.yaml`
- writes `.aos/scan.json`
- can optionally install missing adapter packages with `--apply`

Useful variants:

```bash
aos init --apply
aos init --non-interactive
aos init --non-interactive --adapter codex
```

### 4. Validate

```bash
aos validate
```

## Your First Deliberation

Use the sample strategic brief:

```bash
aos run strategic-council \
  --brief core/briefs/sample-product-decision/brief.md
```

This launches the Strategic Council profile. The Arbiter frames the problem, delegates across the specialist agents, and synthesizes a memo with ranked recommendations, dissent, risks, and next actions.

Output is written under `output/` and the transcript is appended to `.aos/sessions/.../transcript.jsonl`.

## Your First Execution Run

Execution profiles produce an implementation package instead of only a recommendation memo:

```bash
aos run cto-execution \
  --brief core/briefs/sample-cto-execution/brief.md
```

The CTO orchestrator drives a structured workflow across requirements, architecture, planning, security review, and final assembly.

## Replay a Transcript

```bash
aos replay .aos/sessions/<session-id>/transcript.jsonl
```

## Next Steps

- [Creating Agents](../creating-agents/README.md)
- [Creating Profiles](../creating-profiles/README.md)
- [Creating Domains](../creating-domains/README.md)
- [Creating Workflows](../creating-workflows/README.md)
- [Persistent Expertise](../persistent-expertise/README.md)
