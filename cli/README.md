# aos-harness

**Agentic Orchestration System** — Assemble specialized AI agents into deliberation and execution teams.

> **Breaking change in 0.6.0:** `aos-harness` no longer bundles adapter code. You must install the adapter(s) for the AI CLI(s) you want to use as separate packages. If you upgrade from 0.5.x and run `aos run` without the matching `@aos-harness/<name>-adapter` installed, the CLI will print an install hint and exit. See [CHANGELOG](../CHANGELOG.md#060) for the full migration note.

## Prerequisites

- [Bun](https://bun.sh) 1.0+

## Getting Started

### 1. Install the CLI

```bash
npm i -g aos-harness
# or: bun add -g aos-harness
```

### 2. Install an adapter

Pick the AI CLI you'll drive agents with and install the matching adapter. You can install more than one. Versions are lockstep — pin the adapter to the same version as the CLI.

```bash
npm i -g @aos-harness/claude-code-adapter   # Anthropic's Claude Code
npm i -g @aos-harness/gemini-adapter         # Google's Gemini CLI
npm i -g @aos-harness/codex-adapter          # OpenAI's Codex CLI
npm i -g @aos-harness/pi-adapter             # Pi (pi-ai) — direct model SDK
```

### 3. Initialize and run

```bash
# Initialize a project (writes .aos/ and copies core/ into the project)
aos init

# Run a strategic deliberation
aos run strategic-council --brief brief.md

# Run a CTO execution workflow
aos run cto-execution --brief feature-brief.md --domain saas

# List available agents, profiles, and domains
aos list

# Create custom configs
aos create agent my-analyst
aos create profile my-review

# Validate all configurations
aos validate
```

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Uncaught runtime error |
| 2 | Invalid input (unknown adapter, bad path, bad URL, missing adapter package) |
| 3 | Profile tool-policy error (malformed `tools:` block, flag cannot widen profile) |

## What It Does

AOS Harness orchestrates multiple AI agents with distinct cognitive biases into structured deliberation and execution sessions:

- **Deliberation** — Agents debate a strategic question. An Arbiter synthesizes ranked recommendations with documented dissent.
- **Execution** — A CTO orchestrator delegates production work through multi-phase workflows with review gates.

Ships with 13 agent personas, 6 orchestration profiles, 5 domain packs, and full constraint management (time, budget, rounds).

## Documentation

- [Full documentation](https://aos.engineer/docs/getting-started)
- [GitHub repository](https://github.com/aos-engineer/aos-harness)

## License

MIT
