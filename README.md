# AOS Harness

**Agentic Orchestration System** — Assemble specialized AI agents into deliberation and execution teams.

[![CI](https://github.com/aos-engineer/aos-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/aos-engineer/aos-harness/actions/workflows/ci.yml)

---

## What It Is

AOS Harness is a language-agnostic orchestration system for multi-agent AI workflows. It supports two orchestration patterns:

- **Deliberation** — Agents debate a strategic question, the Arbiter synthesizes ranked recommendations with documented dissent. Output: structured memo.
- **Execution** — A CTO/CIO/CEO orchestrator delegates production work to agents who produce architecture, task breakdowns, security reviews, and implementation plans. Output: execution package.

The harness ships with:

- 13 agent personas with distinct cognitive biases and reasoning frameworks
- 6 orchestration profiles (strategic-council, cto-execution, security-review, delivery-ops, architecture-review, incident-response)
- 5 domain packs (SaaS, healthcare, fintech, platform-engineering, personal-decisions)
- 3 skill definitions (code-review, security-scan, task-decomposition)
- Platform adapters for Pi CLI, Claude Code, and extensible to any runtime

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.0+

### Install

```bash
bun add -g aos-harness
```

### Initialize a project

```bash
cd your-project
aos init
```

### Run a deliberation

```bash
# Using the Pi CLI adapter
cd adapters/pi && bun install
pi -e src/index.ts
/aos-run
```

### Run an execution profile

```bash
# Using the AOS CLI directly
bun run cli/src/index.ts run cto-execution --brief core/briefs/sample-cto-execution/brief.md
```

### CLI commands

```bash
aos init                          # Initialize AOS in the current project
aos run [profile]                 # Run a deliberation or execution session
aos run cto-execution --brief ... # Run the CTO execution workflow
aos create agent <name>           # Scaffold a new agent
aos create profile <name>         # Scaffold a new profile
aos create domain <name>          # Scaffold a new domain
aos create skill <name>           # Scaffold a new skill
aos validate                      # Validate all configs
aos list                          # List all agents, profiles, domains, skills
aos replay <transcript.jsonl>     # Replay a session transcript
```

**Requirements:** [Bun](https://bun.sh) (v1.0+), and an API key for your chosen model provider.

---

## Orchestration Patterns

### Deliberation (strategic-council)

Submit a brief with a strategic question. 11 agents debate under time and budget constraints. The Arbiter synthesizes a memo with ranked recommendations, agent stances, dissent, and next actions.

```
Brief → Arbiter frames question → Agents debate (broadcast + targeted rounds)
→ Provocateur stress-tests (speaks last) → Arbiter synthesizes → Memo output
```

### Execution (cto-execution)

Submit a feature request. The CTO orchestrator drives an 8-step workflow with 3 review gates, producing a complete execution package.

```
Brief → Requirements (Advocate + Strategist) → Architecture (Architect)
→ Architecture Review (Architect vs Operator) → Phase Planning (Strategist + Operator)
→ Task Breakdown (Operator) → Security Review (Sentinel)
→ Stress Test (Provocateur) → Final Assembly → Execution Package output
```

---

## Agent Roster

| Agent | Category | Role | Core Bias |
|---|---|---|---|
| **Arbiter** | Orchestrator | Session chair, synthesis | Neutral facilitation |
| **CTO Orchestrator** | Orchestrator | Execution leader | Execution quality |
| **Catalyst** | Perspective | Acceleration, monetization | Speed |
| **Sentinel** | Perspective | Protection, sustainability | Trust |
| **Architect** | Perspective | Systems design, feasibility | System durability |
| **Provocateur** | Perspective | Stress-testing (speaks last) | Truth-seeking |
| **Navigator** | Perspective | Market positioning, timing | Positioning |
| **Advocate** | Perspective | User voice, behavior reality | User behavior |
| **Pathfinder** | Perspective | 10x thinking, asymmetric bets | Asymmetric upside |
| **Strategist** | Perspective | Problem selection, sequencing | Impact per effort |
| **Operator** | Operational | Execution reality, capacity | Execution |
| **Steward** | Operational | Ethics, compliance, governance | Compliance |
| **Auditor** | Operational | Retrospective, institutional memory | Learning |

---

## Architecture

```
aos-harness/
  core/               # Language-agnostic config (YAML + Markdown)
    agents/           # 13 agent personas (orchestrators, perspectives, operational)
    profiles/         # 6 orchestration profiles
    domains/          # 5 domain knowledge packs
    skills/           # 3 skill definitions (aos/skill/v1)
    workflows/        # 7 workflow definitions
    schema/           # JSON Schema for validation
    briefs/           # Sample briefs
  runtime/            # Minimal TypeScript engine (~2000 lines)
    src/              # Engine, constraint engine, delegation router, artifact manager,
                      # workflow runner, template resolver, config loader, output renderer
    tests/            # 194 tests across 12 files
  adapters/           # Platform-specific implementations
    pi/               # Pi CLI adapter (primary — full 4-layer implementation)
    claude-code/      # Claude Code adapter (static artifact generator)
  cli/                # CLI tooling (init, run, create, validate, list, replay)
  docs/               # Specs, plans, getting-started guides
```

### 4-Layer Adapter Contract

| Layer | Purpose | Methods |
|---|---|---|
| L1: Agent Runtime | Agent lifecycle | spawnAgent, sendMessage, destroyAgent |
| L2: Event Bus | Hooks and interception | onSessionStart, onToolCall, onMessageEnd |
| L3: User Interface | Rendering and interaction | registerCommand, renderAgentResponse, promptConfirm |
| L4: Workflow Engine | Process orchestration | dispatchParallel, executeCode, invokeSkill, createArtifact |

---

## Enhanced Capabilities

AOS Harness includes advanced features for production orchestration:

| Capability | Description | Guide |
|---|---|---|
| [Dev Execution](docs/dev-execution/README.md) | Brief to working code in one session | Planning + hierarchical implementation |
| [Domain Enforcement](docs/domain-enforcement/README.md) | Structural file/tool permission boundaries per agent | Path matching, tool allowlists, bash restrictions |
| [Hierarchical Delegation](docs/hierarchical-delegation/README.md) | Agents spawn and manage sub-agents in Lead→Worker chains | Depth limits, domain inheritance |
| [Persistent Expertise](docs/persistent-expertise/README.md) | Agent knowledge accumulates across sessions | Diff-based updates, pruning, review gates |
| [Event Summarization](docs/event-summarization/README.md) | Human-readable event summaries via templates and LLM | Template and batched LLM approach |
| [Session Resumption](docs/session-resumption/README.md) | Pause and resume sessions with full context | Checkpoints, conversation tails |

---

## Documentation

- **Specs:** `docs/specs/2026-03-23-aos-harness-design.md` (core framework)
- **Execution Profiles:** `docs/specs/2026-03-24-aos-execution-profiles/` (4-document spec suite)
- **Getting Started:** `docs/getting-started/README.md`
- **Creating Agents:** `docs/creating-agents/README.md`
- **Creating Profiles:** `docs/creating-profiles/README.md`
- **Creating Workflows:** `docs/creating-workflows/README.md`
- **Creating Skills:** `docs/creating-skills/README.md`
- **Domain Enforcement:** `docs/domain-enforcement/README.md`
- **Hierarchical Delegation:** `docs/hierarchical-delegation/README.md`
- **Persistent Expertise:** `docs/persistent-expertise/README.md`
- **Event Summarization:** `docs/event-summarization/README.md`
- **Session Resumption:** `docs/session-resumption/README.md`

---

## Development

```bash
# Run tests
bun run test

# Type check
bun run typecheck

# Validate all configs
bun run validate

# Security lint
bun run lint:yaml-safety

# Full lint (safety + types)
bun run lint
```

---

## License

MIT
