# Getting Started with AOS Framework

The AOS Framework (Agent Orchestration System) is a config-driven runtime for orchestrating multi-agent deliberation sessions. You define agents with distinct cognitive profiles, assemble them into advisory councils via profiles, and the framework manages structured debate with constraint enforcement, bias protection, and transcript recording -- producing a synthesized memo as output.

## Prerequisites

- **Bun** (v1.0+): JavaScript runtime. Install from [bun.sh](https://bun.sh).
- **Pi CLI**: The AI coding agent CLI that serves as the default adapter runtime. Install from the Pi documentation.
- **Anthropic API Key**: Set `ANTHROPIC_API_KEY` in your environment for metered (pay-per-token) usage, or use a Pi subscription for unmetered access.

## Installation

1. Clone the repository:

```bash
git clone <repository-url> aos-framework
cd aos-framework
```

2. Install dependencies:

```bash
cd runtime && bun install && cd ..
cd adapters/pi && bun install && cd ../..
cd cli && bun install && cd ..
```

3. Initialize AOS in your working directory:

```bash
bun run cli/src/index.ts init --adapter pi
```

This creates a `.aos/config.yaml` file pointing to the Pi adapter.

4. Verify the installation:

```bash
bun run cli/src/index.ts validate
```

You should see all agents, profiles, and domains pass validation.

## Your First Deliberation

1. Review the sample brief at `core/briefs/sample-product-decision/brief.md`. It contains a product strategy question with sections like Situation, Key Question, Constraints, and Stakeholders.

2. Run a dry-run to verify configuration without making API calls:

```bash
bun run cli/src/index.ts run strategic-council \
  --brief core/briefs/sample-product-decision/brief.md \
  --dry-run
```

You should see a simulation summary showing the agent count, constraint configuration, and brief sections found.

3. Launch a real deliberation:

```bash
bun run cli/src/index.ts run strategic-council \
  --brief core/briefs/sample-product-decision/brief.md \
  --domain saas
```

The Arbiter (orchestrator) will read your brief and delegate to the 11 specialist agents. Each agent analyzes the problem through its unique cognitive lens. The session runs within the constraint bounds defined in the profile (2-10 minutes, $1-$10, 2-8 rounds).

4. Once the session completes, find the output in the `output/` directory. The memo and transcript are saved there.

## Understanding the Output

The primary output is a **structured memo** with the following sections:

- **Executive Summary**: High-level recommendation synthesized from all perspectives.
- **Recommendations**: Ranked options with confidence levels and supporting/dissenting agents.
- **Risk Assessment**: Key risks identified, particularly by the Sentinel and Auditor agents.
- **Dissenting Views**: Formally documented disagreements -- AOS treats dissent as signal, not noise.
- **Next Actions**: Concrete next steps with owners and timelines.
- **Deliberation Metadata**: Session statistics including cost, duration, and round count.

A **JSONL transcript** is also saved, recording every delegation, response, constraint check, and final statement. You can replay it:

```bash
bun run cli/src/index.ts replay output/<session>/transcript.jsonl
```

## Next Steps

- **[Creating Agents](../creating-agents/README.md)**: Design custom agents with unique cognitive frameworks.
- **[Creating Profiles](../creating-profiles/README.md)**: Assemble agents into deliberation councils.
- **[Creating Domains](../creating-domains/README.md)**: Add domain-specific overlays for specialized analysis.
- Run `bun run cli/src/index.ts list` to see all available agents, profiles, and domains.
- Run `bun run cli/src/index.ts create agent <name>` to scaffold a new agent.
