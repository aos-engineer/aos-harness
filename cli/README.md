# aos-harness

**Agentic Orchestration System** — Assemble specialized AI agents into deliberation and execution teams.

## Prerequisites

- [Bun](https://bun.sh) 1.0+

## Install

```bash
bun add -g aos-harness
```

Or run directly:

```bash
bunx aos-harness init
```

## Quick Start

```bash
# Initialize a project
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
