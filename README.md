# AOS Framework

**Agentic Orchestration System**

Assemble specialized AI agents into deliberation teams that debate, challenge, and synthesize strategic recommendations.

---

## What It Is

AOS Framework is a language-agnostic orchestration layer for multi-agent deliberation. It ships with:

- 12 original agent personas with distinct reasoning biases
- Config-driven profiles that control team composition, turn order, and model assignment
- Optional domain packs that load domain-specific context and constraints
- Platform adapters that host deliberations inside different runtimes (Pi CLI is the primary adapter)

The framework separates orchestration concerns (core config, agent definitions) from execution concerns (runtime engine) and platform concerns (adapters), so it can run in any environment that can execute a JavaScript or TypeScript process.

---

## 3-Tier Model

| Tier | Who | What You Do |
|------|-----|-------------|
| Install and Run | Anyone | Clone, install, run `/aos-run` — zero configuration required |
| Customize and Build | Practitioners | Edit profiles, swap domain packs, tune model tiers |
| Full Platform | Builders | Write new adapters, extend the runtime, add agent personas |

---

## Quick Start

The primary adapter is the Pi CLI adapter.

```bash
cd aos-framework/adapters/pi && bun install
pi -e src/index.ts
/aos-run
```

Requirements: [Pi CLI](https://pi.dev), [Bun](https://bun.sh), and `ANTHROPIC_API_KEY` set in your environment.

---

## Agent Roster

| Agent       | Category      | Role                        | Core Bias                                      |
|-------------|---------------|-----------------------------|------------------------------------------------|
| Arbiter     | Orchestrator  | Session chair               | Neutral facilitation, synthesis over advocacy  |
| Catalyst    | Perspective   | Creative accelerant         | Novelty, reframe, break assumptions            |
| Sentinel    | Perspective   | Risk and threat monitor     | Downside awareness, system integrity           |
| Architect   | Perspective   | Systems designer            | Structure, coherence, long-term fit            |
| Provocateur | Perspective   | Devil's advocate            | Stress-test consensus, surface blind spots     |
| Navigator   | Perspective   | Strategic orientation       | Direction, prioritisation, resource trade-offs |
| Advocate    | Perspective   | Stakeholder voice           | Human impact, equity, legitimacy               |
| Pathfinder  | Perspective   | Exploration and optionality | Map unknowns, preserve future choices          |
| Strategist  | Perspective   | Competitive positioning     | Advantage, timing, external dynamics           |
| Operator    | Operational   | Execution realism           | Feasibility, sequencing, operational drag      |
| Steward     | Operational   | Resource and ethics guardian| Sustainability, values, stewardship            |
| Auditor     | Operational   | Evidence and logic reviewer | Factual accuracy, reasoning quality            |

### Tension Pairs

The framework seeds productive conflict by pairing agents with opposing biases:

- Catalyst vs Sentinel — acceleration vs caution
- Provocateur vs Architect — disruption vs coherence
- Pathfinder vs Operator — optionality vs execution realism
- Navigator vs Advocate — strategic efficiency vs human impact
- Strategist vs Steward — competitive gain vs sustainable practice
- Auditor vs Catalyst — evidence discipline vs generative exploration

---

## Architecture Overview

```
aos-framework/
  core/          # Agent definitions, profiles, domain packs, schema
  runtime/       # Execution engine — deliberation loop, phase management
  adapters/      # Platform adapters (pi/, and future targets)
```

| Layer    | Purpose                                                            |
|----------|--------------------------------------------------------------------|
| `core/`  | Source of truth for agent personas, team profiles, and config      |
| `runtime/` | Platform-agnostic engine that drives deliberation phases         |
| `adapters/` | Thin host integrations that implement the `AOSAdapter` contract |

---

## Project Structure

```
aos-framework/
  core/
    agents/
      orchestrators/    # Arbiter
      perspectives/     # Catalyst, Sentinel, Architect, Provocateur,
                        # Navigator, Advocate, Pathfinder, Strategist
      operational/      # Operator, Steward, Auditor
    briefs/             # Session brief templates
    domains/            # Optional domain context packs
    profiles/           # Team composition and turn-order profiles
    schema/             # Config and message schema definitions
  runtime/
    src/                # Deliberation engine, phase runner, memo writer
  adapters/
    pi/
      src/              # Pi CLI adapter (agent-runtime, event-bus, ui, workflow)
      README.md         # Pi adapter documentation
  docs/
    specs/              # Framework specification
```

---

## Documentation

- Framework specification and design rationale: `docs/specs/`

---

## License

License TBD.
