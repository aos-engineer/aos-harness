# Persistent Expertise

Agents accumulate domain-specific knowledge across sessions via structured YAML files. An Architect remembers your codebase patterns. A Sentinel retains threat models. Knowledge is loaded at session start and updated at session end.

This is distinct from the scratch pad `expertise` field (which gives agents a read/write notes file). `expertiseConfig` controls a structured learning system that persists categorical knowledge and injects it into the agent's system prompt every time it runs.

## Enabling Expertise

Add an `expertiseConfig` block to the agent's `agent.yaml`:

```yaml
expertiseConfig:
  enabled: true
  max_lines: 5000               # Cap total entries across all categories
  structure:                    # Knowledge categories this agent tracks
    - architecture_patterns
    - recurring_failure_modes
    - domain_heuristics
  read_on: session_start        # When to load expertise
  update_on: session_end        # When to persist updates
  scope: per-project            # per-project | global
  mode: read-write              # read-write | read-only (for compliance knowledge)
  auto_commit: review           # "true" | review
```

### Field Reference

| Field | Values | Description |
|---|---|---|
| `enabled` | `true` / `false` | Activates the persistent learning system |
| `max_lines` | integer | Total entry cap across all categories |
| `structure` | list of strings | Knowledge categories the agent tracks |
| `read_on` | `session_start` | When expertise is loaded into the prompt |
| `update_on` | `session_end` | When the diff is applied or staged |
| `scope` | `per-project` / `global` | Whether knowledge is project-specific or shared across projects |
| `mode` | `read-write` / `read-only` | `read-only` for agents that consume compliance knowledge without modifying it |
| `auto_commit` | `"true"` / `review` | Whether updates are applied immediately or staged for CLI confirmation |

Note: `expertiseConfig` is separate from the existing `expertise` field. The `expertise` field defines scratch pad file paths. `expertiseConfig` controls the persistent learning system.

## Expertise File Structure

The harness writes one expertise file per agent per project, keyed by a hash of the project root:

```yaml
# .aos/expertise/architect-{project-hash}.yaml
last_updated: "2026-04-10T14:30:00Z"
session_count: 4
knowledge:
  architecture_patterns:
    - "Service layer uses repository pattern with Drizzle ORM"
    - "Auth flows through middleware chain, not per-route"
  recurring_failure_modes:
    - "WebSocket reconnection drops events during API restart"
  domain_heuristics:
    - "Team prefers explicit error types over generic throws"
```

Each top-level key under `knowledge` corresponds to a category declared in the agent's `structure` list. The harness ignores any category present in the file but absent from the current `structure` -- it will not be injected, but it is not deleted either.

## How Updates Work

Updates are diff-based, not full rewrites. At session end, an economy-tier model reviews the session transcript and produces a structured diff:

```json
{
  "additions": {
    "architecture_patterns": [
      "API gateway pattern added in v2.3 for rate limiting"
    ]
  },
  "removals": {
    "recurring_failure_modes": [
      "WebSocket reconnection drops events during API restart"
    ]
  }
}
```

Only the changes in the diff are applied to the YAML file. This limits the blast radius of bad summarization -- a poor session cannot overwrite years of accumulated knowledge. Duplicate entries are automatically filtered before writes.

## Auto-Commit vs Review Mode

The `auto_commit` field controls when the diff is merged into the expertise file.

### `auto_commit: "true"`

The diff is applied immediately after the session ends. The expertise file is updated without human intervention.

Use this for agents where accumulated knowledge is low-stakes or easily correctable -- such as an Architect accumulating codebase patterns, or a Catalyst tracking commercial signals.

### `auto_commit: review`

The diff is written to a pending file alongside the expertise file:

```
.aos/expertise/sentinel-{project-hash}.yaml
.aos/expertise/sentinel-{project-hash}.pending.yaml
```

The pending diff is not merged until a human confirms it via the CLI. The agent continues to load only the committed expertise file at session start -- pending changes are never injected until approved.

```bash
# Review pending expertise updates
bun run cli/src/index.ts expertise review sentinel

# Approve a pending update
bun run cli/src/index.ts expertise approve sentinel

# Discard a pending update
bun run cli/src/index.ts expertise discard sentinel
```

Review mode is recommended for Sentinel, Steward, and any agent responsible for compliance or security knowledge. A bad auto-committed update to a Sentinel's threat model could cause the agent to miss real risks in future sessions.

## Pruning

When the total number of entries across all categories exceeds `max_lines`, the harness removes the oldest entries first (age-based FIFO). Entries are pruned proportionally across categories -- no single category monopolizes the budget by growing without bound.

Example: with `max_lines: 100` and three categories at 40 / 40 / 40 entries (120 total), 20 entries are removed. Each category loses approximately 7 entries (the oldest in each).

Value-based pruning -- where the harness scores entries by relevance before removing them -- is a planned future enhancement.

## Prompt Injection

At session start, the expertise file is loaded and injected as a `## Prior Knowledge` section in the agent's system prompt, immediately following the agent's standard content:

```markdown
## Prior Knowledge
_From 4 previous session(s), last updated 2026-04-10T14:30:00Z_

### architecture patterns
- Service layer uses repository pattern with Drizzle ORM
- Auth flows through middleware chain, not per-route

### recurring failure modes
- WebSocket reconnection drops events during API restart

### domain heuristics
- Team prefers explicit error types over generic throws
```

The injection uses the `{{prior_knowledge}}` template variable in `prompt.md`. If the expertise file does not exist or is empty, the block is omitted entirely -- the agent receives no prior knowledge section on its first session.

| Variable | Description |
|---|---|
| `{{prior_knowledge}}` | Rendered Prior Knowledge block, or empty string if no expertise exists |

## Troubleshooting

**First session -- agent starts with no knowledge.**
This is expected. The expertise file does not exist yet. The agent runs without a Prior Knowledge block. At session end, the first diff is generated and either committed or staged for review depending on `auto_commit`.

**Expertise file is growing too large.**
Reduce `max_lines` or narrow the `structure` list to fewer, more focused categories. Removing a category from `structure` stops new entries from being added and stops the category from being injected, but does not delete existing entries from the YAML file.

**A bad update was applied in `auto_commit: "true"` mode.**
Open `.aos/expertise/{agent-id}-{project-hash}.yaml` and manually remove the incorrect entries. The file is plain YAML and is safe to edit by hand. The harness will read your edited version at the next session start.

**Pending reviews are accumulating.**
Run `bun run cli/src/index.ts expertise review {agent-id}` to inspect each pending diff. Approve what is correct and discard what is not. Pending diffs do not expire, but they also do not affect the agent until approved.

**Agent with `mode: read-only` is not learning.**
This is correct behavior. `read-only` agents load expertise but cannot update it. Knowledge for read-only agents must be seeded or maintained by an external process or by another agent with write access to the same file.
