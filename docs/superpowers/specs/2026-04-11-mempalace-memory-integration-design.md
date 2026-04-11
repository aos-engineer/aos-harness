# MemPalace Memory Integration Design

**Date:** 2026-04-11
**Status:** Draft
**Author:** Segun Kolade + Claude

## Overview

Integrate [MemPalace](https://github.com/milla-jovovich/mempalace) as the first pluggable memory backend for the AOS framework. MemPalace is a local-first, verbatim memory system that uses a spatial metaphor (wings/halls/rooms/closets/drawers) backed by ChromaDB, achieving 96.6% recall on LongMemEval without LLM summarization.

The integration adds a `MemoryProvider` abstraction to the AOS runtime. MemPalace is the first provider; the existing `ExpertiseManager` becomes a lightweight fallback. Future memory systems can be added by implementing the same interface.

## Goals

1. Give AOS agents persistent, high-fidelity memory across sessions
2. The orchestrator acts as memory gatekeeper — curating writes at session end and approving recall requests mid-session
3. MemPalace is the first memory provider, but the architecture supports swapping in other backends
4. AOS works without MemPalace installed (graceful fallback to existing expertise system)
5. Operational agents can access MemPalace tools directly for hands-on memory management

## Non-Goals

- Porting MemPalace's internals into TypeScript (we talk to it via MCP, not embed it)
- Replacing MemPalace's ChromaDB with a different vector store
- Auto-mining codebases (users run `mempalace mine` separately)
- AAAK dialect integration (experimental in MemPalace, not stable enough to depend on)

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Palace structure mapping | Wing = Project, Room = Agent | Users work on multiple projects; clean separation per project, per-agent knowledge within each |
| Provisioning | Hybrid — AOS offers setup during `aos init`, detects existing installs, falls back to expertise | Smooth onboarding without hard dependency |
| What triggers memory writes | Orchestrator decides at session end | Curates quality over quantity; token-efficient; self-regulating size |
| Mid-session recall | Orchestrator-gated | Agents request recall; orchestrator approves/denies; prevents noisy searches and token runaway |
| Agent direct access | Operational agents only | Perspective agents go through orchestrator; operational agents (Operator, Steward, Auditor) get full MCP tools |
| Communication with MemPalace | MCP protocol (stdio JSON-RPC) | Aligns with MemPalace's design; keeps TypeScript runtime clean |

## Architecture

### MemoryProvider Interface

The core abstraction that all memory backends implement.

```typescript
interface MemoryProvider {
  readonly id: string;           // "mempalace" | "expertise" | future providers
  readonly name: string;         // Human-readable name

  // Lifecycle
  initialize(config: MemoryConfig): Promise<void>;
  isAvailable(): Promise<boolean>;

  // Wake-up — called at session start, returns context to inject into agents
  wake(projectId: string, agentId?: string): Promise<WakeContext>;

  // Recall — orchestrator-gated semantic search
  recall(query: string, opts: RecallOpts): Promise<RecallResult>;

  // Remember — orchestrator commits content to long-term memory
  remember(content: string, opts: RememberOpts): Promise<RememberId>;

  // Status
  status(): Promise<MemoryStatus>;
}

interface WakeContext {
  identity: string;       // L0 — who is this AI? (~100 tokens)
  essentials: string;     // L1 — critical facts (~500-800 tokens)
  tokenEstimate: number;  // Total tokens for budget tracking
}

interface RecallOpts {
  projectId: string;      // Wing
  agentId?: string;       // Room (optional — cross-agent search if omitted)
  hall?: string;          // Memory type filter (facts, events, discoveries, etc.)
  maxResults?: number;    // Default 5
}

interface RecallResult {
  entries: RecallEntry[];
  tokenEstimate: number;
}

interface RecallEntry {
  content: string;        // Verbatim drawer content
  wing: string;
  room: string;
  hall: string;
  similarity: number;     // 0-1 relevance score
  source?: string;        // Original source file if applicable
}

interface RememberOpts {
  projectId: string;      // Wing
  agentId: string;        // Room (which agent produced this)
  hall?: string;          // Auto-detected if omitted
  source?: string;        // Attribution metadata
}

type RememberId = string;

interface MemoryConfig {
  provider: "mempalace" | "expertise";
  mempalace?: {
    palacePath: string;
    projectWing: string;
    wakeLayers: ("L0" | "L1")[];
    autoHall: boolean;
  };
  expertise?: {
    maxLines: number;
    scope: "per-project" | "global";
  };
  orchestrator: {
    rememberPrompt: "session_end" | "per_round";
    recallGate: boolean;
    maxRecallPerSession: number;
  };
}

interface MemoryStatus {
  provider: string;
  available: boolean;
  drawerCount?: number;
  wings?: string[];
  rooms?: Record<string, string[]>;
}
```

### Memory Configuration

Project-level config at `.aos/memory.yaml`:

```yaml
api_version: aos/memory/v1

provider: mempalace           # "mempalace" | "expertise"

mempalace:
  palace_path: ~/.mempalace/palace
  project_wing: my-project
  wake_layers: [L0, L1]
  auto_hall: true

expertise:
  max_lines: 200
  scope: per-project

orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
```

**Fallback behavior:**
- `provider: mempalace` but not installed at runtime -> warn, fall back to `expertise`
- `provider: expertise` -> use existing `ExpertiseManager`
- No config file -> default to `expertise` (backwards compatible)

### `aos init` Flow

```
$ aos init my-project

  AOS Project Setup
  -----------------

  Memory Provider:
  > MemPalace (recommended - high-fidelity recall, local ChromaDB)
    Basic Expertise (built-in - lightweight YAML-based)
    None (no persistent memory)

  [If MemPalace selected but not installed:]
  MemPalace not found. Install it? (pip install mempalace) [Y/n]

  [If MemPalace installed:]
  Palace path: ~/.mempalace/palace (enter to accept, or type custom path)
  Wing name for this project: my-project

  > Memory configured - .aos/memory.yaml written
```

### Engine Integration

Three integration points in the session lifecycle:

**Session Start:**
1. Load memory config from `.aos/memory.yaml`
2. Initialize provider (MemPalace or expertise fallback)
3. Call `provider.wake(projectId)` to get L0+L1 context
4. Inject wake context into orchestrator's system prompt
5. Inject per-agent wake context into each agent on spawn

**Mid-Session (orchestrator-gated):**
1. Agent includes a recall request in its response
2. Orchestrator decides: approve or deny
3. If approved: orchestrator calls `aos_recall` tool, result injected into requesting agent's context via `adapter.injectContext()`
4. `recall_count++` checked against `max_recall_per_session`

**Session End:**
1. Orchestrator receives memory curation prompt
2. Reviews session transcript and artifacts
3. Calls `aos_remember` tool for each significant memory
4. Transcript events logged: `memory_committed`

### Orchestrator Tools

Two new tools available exclusively to the orchestrator:

```typescript
// aos_remember — commit content to long-term memory
{
  name: "aos_remember",
  description: "Commit important content to long-term memory",
  input: {
    content: string,       // Verbatim content to store
    agent: string,         // Which agent produced this (becomes the room)
    hall?: string,         // "facts" | "events" | "discoveries" | "preferences" | "advice"
  }
}

// aos_recall — search long-term memory
{
  name: "aos_recall",
  description: "Search long-term memory for relevant past knowledge",
  input: {
    query: string,
    agent?: string,        // Limit to specific agent's memories (room)
    hall?: string,         // Limit to memory type
    max_results?: number,  // Default 5
  }
}
```

**Memory curation prompt (injected at session end):**

```
You are ending this deliberation session. Review the session outcomes and
decide what should be committed to long-term memory.

Guidelines:
- Store decisions, conclusions, and rationale - not the debate that led to them
- Store discoveries and insights that would be valuable in future sessions
- Store verbatim - do not summarize or paraphrase
- Tag each memory with the agent that produced it
- Skip procedural noise (constraint checks, routing, bias tracking)

Use the aos_remember tool for each item worth keeping.
```

### New Transcript Events

```typescript
| "memory_wake"            // L0+L1 loaded at session start
| "memory_recall"          // Mid-session search executed
| "memory_recall_denied"   // Orchestrator denied a recall request
| "memory_committed"       // Content stored to long-term memory
```

### Provider Implementations

**MemPalaceProvider:**

Communicates with MemPalace's MCP server as an external process.

```
AOS Runtime (TypeScript/Bun)
    |
    +- MemPalaceProvider
    |      |
    |      +- wake()     -> mempalace wake-up --wing <projectId> --json
    |      +- recall()   -> MCP: mempalace_search (with wing/room/hall filters)
    |      +- remember() -> MCP: mempalace_add_drawer (tagged with metadata)
    |      +- status()   -> MCP: mempalace_status
    |
    MemPalace MCP Server (Python, separate process, stdio JSON-RPC)
        |
        +- ChromaDB (local, on-disk)
```

- Primary communication: MCP protocol via stdio transport
- Provider lazily starts the MCP server on first use, keeps it alive for session duration
- Fallback: CLI subprocess calls with `--json` flag (slower, process spawn per call)

**ExpertiseProvider:**

Wraps the existing `ExpertiseManager` with the `MemoryProvider` interface.

```
AOS Runtime (TypeScript/Bun)
    |
    +- ExpertiseProvider
           |
           +- wake()     -> ExpertiseManager.parseExpertise() + injectIntoPrompt()
           +- recall()   -> String matching against loaded expertise categories
           +- remember() -> ExpertiseManager.applyDiff() -> YAML write
           +- status()   -> session_count, category count, entry count
```

- Thin wrapper, no rewrite of existing code
- `recall()` is basic (string matching, not semantic search) but functional

### Agent-Facing Memory (Direct MCP Tools)

In addition to the runtime layer, operational agents can access MemPalace's full 19-tool MCP suite directly.

**New skill definition:**

```yaml
# core/skills/mempalace-direct/skill.yaml
api_version: aos/skill/v1
id: mempalace-direct
name: MemPalace Direct Access
description: Full read/write access to MemPalace tools for agents that need it

platform_bindings:
  claude-code: null
  pi: mempalace-mcp

compatible_agents:
  - operator
  - steward
  - auditor
```

**Access tiers:**

| Agent Type | Runtime Memory (aos_remember/recall) | Direct MemPalace MCP Tools |
|---|---|---|
| Orchestrator | Full access - gates all reads/writes | No (uses runtime tools) |
| Perspective agents | Request via orchestrator only | No |
| Operational agents | Can also use runtime tools | Yes - full 19 MCP tools |
| Developer (human) | N/A | Yes - CLI and MCP |

Enforced via existing `DomainEnforcer` — agents without `mempalace-direct` skill have MemPalace MCP tools in their `tool_denylist`.

## Files to Create or Modify

**New files:**
- `runtime/src/memory-provider.ts` — `MemoryProvider` interface and types
- `runtime/src/mempalace-provider.ts` — `MemPalaceProvider` implementation
- `runtime/src/expertise-provider.ts` — `ExpertiseProvider` wrapper
- `runtime/src/memory-config.ts` — Config loader for `.aos/memory.yaml`
- `core/skills/mempalace-direct/skill.yaml` — Direct MCP access skill
- `core/schema/memory.schema.json` — JSON Schema for memory config validation
- `cli/src/commands/init-memory.ts` — Memory setup flow for `aos init`

**Modified files:**
- `runtime/src/engine.ts` — Add `memoryProvider` field, wire into session lifecycle (start/mid/end)
- `runtime/src/types.ts` — Add transcript event types, memory-related interfaces
- `cli/src/commands/init.ts` — Add memory provider selection step
- `core/agents/orchestrators/*/agent.yaml` — Add `aos_remember` and `aos_recall` to orchestrator tools

**Unchanged:**
- `runtime/src/expertise-manager.ts` — No modifications; `ExpertiseProvider` wraps it as-is

## Testing & Validation

**Unit tests:**
- `MemoryProvider` interface contract tests (any provider must pass)
- `ExpertiseProvider` correctly wraps `ExpertiseManager` behavior
- `MemPalaceProvider` maps wake/recall/remember to MCP calls (mocked MCP server)
- Memory config loading and validation
- Fallback behavior when MemPalace not installed

**Integration tests:**
- Full session lifecycle: wake -> mid-session recall -> session end remember -> verify drawers in ChromaDB
- Same flow with expertise fallback, verify YAML updates
- Provider switching on same project
- Orchestrator recall gating (approve/deny paths)
- `max_recall_per_session` cap enforcement

**Token efficiency benchmarks:**
- Wake context token count across palace sizes (100, 1000, 10000 drawers)
- Recall result token count at varying `max_results`
- Total session token usage: with memory vs. without vs. expertise-only
- Targets: wake < 1000 tokens, individual recall < 2000 tokens

**Manual validation:**
- `aos init` with MemPalace selection (install prompt, config generation)
- Multi-session scenario: Session 1 commits memories -> Session 2 wakes with Session 1 context -> verify recall accuracy
- Run without MemPalace installed -> verify clean fallback with warning
