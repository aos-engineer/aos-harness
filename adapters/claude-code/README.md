# AOS Harness — Claude Code Adapter

A code generator that reads AOS core config and produces static `.claude/` artifacts for use with Claude Code's native agent and command system.

## What It Does

This adapter is a **code generator**, not a runtime adapter. It reads AOS profile, agent, and domain configs, then produces:

- **`.claude/agents/aos-<id>.md`** — One agent definition file per AOS agent (frontmatter YAML + markdown prompt)
- **`.claude/commands/aos-<profile>.md`** — Slash command for running the profile as an orchestrated deliberation
- **`CLAUDE-aos.md`** — Fragment to append to your project's `CLAUDE.md` with agent roster, commands, and constraint documentation

## Usage

```bash
# Generate from a profile
bun run src/generate.ts --profile strategic-council --output .claude-aos

# Generate with a domain overlay
bun run src/generate.ts --profile strategic-council --domain fintech --output .claude-aos

# Generate directly into your project's .claude directory
bun run src/generate.ts --profile strategic-council --output /path/to/your/project/.claude
```

### Arguments

| Argument | Required | Default | Description |
|---|---|---|---|
| `--profile <name>` | Yes | — | Profile to generate from (e.g., `strategic-council`) |
| `--domain <name>` | No | — | Domain overlay to apply (e.g., `fintech`, `saas`) |
| `--output <dir>` | No | `.claude-aos` | Output directory for generated files |

## Installing Generated Artifacts

After generating, copy the artifacts into your project:

```bash
cp -r .claude-aos/agents/ /path/to/project/.claude/agents/
cp -r .claude-aos/commands/ /path/to/project/.claude/commands/
cat .claude-aos/CLAUDE-aos.md >> /path/to/project/CLAUDE.md
```

Then use the generated slash command in Claude Code:

```
/aos-strategic-council <your brief here>
```

## Limitations vs. Pi Adapter

These are documented limitations — not bugs:

- **No runtime constraint engine** — Constraints are embedded as advisory prompt instructions
- **No bias limit enforcement** — Advisory only, the Arbiter is instructed but not blocked
- **No real-time budget tracking** — Budget targets are advisory
- **No TUI widgets or steerMessage** — Terminal text output only
- **Parallel dispatch** — Uses Claude Code's native Agent tool for concurrency

## Model Tier Mapping

| AOS Tier | Claude Code Model |
|---|---|
| economy | haiku |
| standard | sonnet |
| premium | opus |

## Development

```bash
bun install
bun run src/generate.ts --profile strategic-council --output /tmp/test
bun x tsc --noEmit  # typecheck
```
