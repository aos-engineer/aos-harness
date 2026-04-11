# CLI Adapter Integration Design

**Date:** 2026-04-11
**Status:** Draft
**Author:** Segun Kolade + Claude
**Depends on:** Full Adapter Implementations (2026-04-11, merged)

## Overview

Wire the new runtime adapters (Claude Code, Gemini, Codex) into the `aos run` CLI command so they can be used end-to-end: config reading, adapter loading, engine wiring, interactive session with commands, constraint gauge display, and graceful shutdown.

## Goals

1. `aos run` works with `claude-code`, `gemini`, and `codex` adapters — not just Pi
2. Full interactive session support: `/aos-halt`, `/aos-resume`, `/aos-end`, `/aos-status`, `/aos-steer`
3. `.aos/adapter.yaml` config reading with model overrides passed to adapter runtime
4. Text-mode constraint gauges for terminal output
5. Shared agent discovery helpers extracted from Pi (no duplication)

## Non-Goals

- Changing Pi's code path — Pi keeps its separate extension-based entry point
- Headless/CI mode — out of scope (future work)
- OpenCode adapter — deferred pending CLI investigation

---

## Architecture

### New Module: `cli/src/adapter-session.ts`

A single module that encapsulates the generic adapter session lifecycle for all non-Pi adapters. `run.ts` calls it instead of printing "not yet fully supported."

**Exported function:**

```typescript
async function runAdapterSession(config: AdapterSessionConfig): Promise<void>
```

**Config shape:**

```typescript
interface AdapterSessionConfig {
  platform: string;           // "claude-code" | "gemini" | "codex"
  profileDir: string;         // resolved profile directory
  briefPath: string;          // path to brief.md
  domainName: string | null;  // optional domain
  root: string;               // harness root directory
  sessionId: string;          // generated session ID
  deliberationDir: string;    // output directory
  verbose: boolean;
  workflowConfig: any | null; // execution profile workflow, if applicable
  workflowsDir: string;       // workflows directory
  modelOverrides?: Partial<Record<string, string>>; // from .aos/adapter.yaml
}
```

### Integration Point in `run.ts`

Replace the current `else` block (lines 376-385) with:

```typescript
} else {
  // Read adapter-specific config
  const adapterConfig = readAdapterConfig(root);
  await runAdapterSession({
    platform: adapter,
    profileDir: profileDir!,
    briefPath,
    domainName,
    root,
    sessionId,
    deliberationDir,
    verbose: !!args.flags.verbose,
    workflowConfig: isExecutionProfile ? workflowConfig : null,
    workflowsDir,
    modelOverrides: adapterConfig?.model_overrides,
  });
}
```

---

## Detailed Design

### 1. Dynamic Adapter Loading

Map platform names to adapter packages:

```typescript
const ADAPTER_MAP: Record<string, { package: string; className: string }> = {
  "claude-code": { package: "@aos-harness/claude-code-adapter", className: "ClaudeCodeAgentRuntime" },
  "gemini":      { package: "@aos-harness/gemini-adapter",      className: "GeminiAgentRuntime" },
  "codex":       { package: "@aos-harness/codex-adapter",       className: "CodexAgentRuntime" },
};
```

**Loading flow:**
1. Look up platform in `ADAPTER_MAP`
2. Try `await import(package)` — works if workspace package is linked
3. If import fails, fall back to `import(join(root, "adapters", platform, "src", "index.ts"))`
4. If both fail, exit with error: `"Adapter for <platform> not found."`
5. Extract runtime class: `mod[className]`
6. Instantiate: `new RuntimeClass(eventBus, modelOverrides)`

### 2. Layer Instantiation & Composition

```typescript
const eventBus = new BaseEventBus();
const agentRuntime = new RuntimeClass(eventBus, config.modelOverrides);
const ui = new TerminalUI();
const workflow = new BaseWorkflow(agentRuntime, config.root);

const adapter = composeAdapter(agentRuntime, eventBus, ui, workflow);
```

All imported from `@aos-harness/adapter-shared`.

### 3. Agent Discovery & Engine Creation

Shared helper functions extracted from Pi's `index.ts`:

```typescript
discoverAgents(agentsDir: string): Map<string, string>
  // Recursively walk core/agents/, find agent.yaml files, return id → dir map

createFlatAgentsDir(projectRoot: string, agentMap: Map<string, string>): string
  // Create .aos/_flat_agents/ with symlinks for engine resolution

findProjectRoot(cwd: string): string | null
  // Walk up from cwd looking for core/ or .aos/
```

These are extracted into `cli/src/adapter-helpers.ts`. Pi's `index.ts` is updated to import from this shared location instead of defining them inline.

**Engine wiring:**
```typescript
const agentsDir = join(root, "core", "agents");
const agentMap = discoverAgents(agentsDir);
const flatAgentsDir = createFlatAgentsDir(root, agentMap);
const domainsDir = join(root, "core", "domains");

const engine = new AOSEngine(adapter, config.profileDir, {
  agentsDir: flatAgentsDir,
  domain: config.domainName ?? undefined,
  domainDir: config.domainName ? domainsDir : undefined,
});

await engine.start(config.briefPath);
```

### 4. Arbiter Prompt Resolution

Same as Pi — read `prompt.md` from the arbiter agent directory, resolve template variables:

```typescript
const templateVars = {
  session_id: config.sessionId,
  brief_slug: briefSlug,
  brief: briefContent,
  agent_id: "arbiter",
  agent_name: "Arbiter",
  participants: participantNames.join(", "),
  constraints: constraintsStr,
  output_path: memoPath,
  deliberation_dir: deliberationDir,
  transcript_path: transcriptPath,
};

const resolvedPrompt = resolveTemplate(rawPrompt, templateVars);
adapter.setOrchestratorPrompt(resolvedPrompt);
```

### 5. Interactive Commands

Registered on TerminalUI before entering the readline loop:

| Command | Action |
|---------|--------|
| `/aos-halt` | Set `halted = true`, print "Deliberation paused. Type /aos-resume to continue." |
| `/aos-resume` | Set `halted = false`, re-send last pending message to engine |
| `/aos-end` | Call `engine.end()`, trigger graceful shutdown (memo writing, cost summary) |
| `/aos-status` | Print constraint gauges to console |
| `/aos-steer <msg>` | Queue message via `ui.steerMessage(msg)`, inject on next arbiter turn |

### 6. Readline Loop

```typescript
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.on("line", async (input) => {
  const trimmed = input.trim();
  if (!trimmed) return;

  if (trimmed.startsWith("/aos-")) {
    const [cmd, ...rest] = trimmed.slice(1).split(" ");
    await ui.dispatchCommand(cmd, rest.join(" "));
  } else {
    // Treat raw input as steer message
    ui.steerMessage(trimmed);
  }
});
```

The loop runs concurrently with the engine's deliberation. The engine drives itself (arbiter sends messages, delegates to agents, checks constraints). User input steers or controls flow.

**Exit conditions:**
- Engine fires `onSessionShutdown` → close readline, print summary, exit 0
- User types `/aos-end` → engine wraps up, then shutdown flow
- Ctrl+C → abort all processes, exit 130

### 7. Text-Mode Constraint Gauges

Printed on `/aos-status` and after each deliberation round (via `onMessageEnd` event):

```
  TIME:   4.2 min  [████████░░░░░░░░] (min: 2, max: 10)
  BUDGET: $0.45    [██░░░░░░░░░░░░░░] (min: $1, max: $10)
  ROUNDS: 3        [████░░░░░░░░░░░░] (min: 2, max: 8)
```

Helper function `renderTextGauge(label, value, min, max, unit)` produces each line with ANSI coloring:
- Green when below min
- Yellow when between min and approaching max
- Red when approaching or at max

### 8. Config Reading

**`.aos/adapter.yaml`** is read by `adapter-session.ts` at startup:

```typescript
function readAdapterConfig(root: string): AdapterConfig | null {
  const configPath = join(root, ".aos", "adapter.yaml");
  if (!existsSync(configPath)) return null;
  const raw = readFileSync(configPath, "utf-8");
  const config = yaml.load(raw) as AdapterConfig;
  return config;
}
```

**`AdapterConfig` type:**
```typescript
interface AdapterConfig {
  platform?: string;
  model_overrides?: Partial<Record<string, string>>;
  theme?: string;
  editor?: string;
}
```

`model_overrides` are passed to the adapter runtime constructor. `theme` and `editor` are stored for TerminalUI/workflow use.

---

## File Changes

### New Files
| File | Responsibility |
|------|---------------|
| `cli/src/adapter-session.ts` | Generic adapter session lifecycle (~250-350 lines) |
| `cli/src/adapter-helpers.ts` | Shared agent discovery helpers (~80 lines, extracted from Pi) |

### Modified Files
| File | Change |
|------|--------|
| `cli/src/commands/run.ts` | Replace "not yet supported" block with `runAdapterSession()` call, add `readAdapterConfig()` |
| `adapters/pi/src/index.ts` | Import `discoverAgents`, `createFlatAgentsDir`, `findProjectRoot` from `cli/src/adapter-helpers.ts` instead of defining inline |

### Adapter Entry Points (No Change Needed)
The adapter `index.ts` files stay as barrel exports. The CLI handles instantiation — adapters just export their runtime class.

---

## Engine Integration & Arbiter Orchestration

**Critical architecture point:** In the Pi adapter, the Pi host process *is* the arbiter — Pi's AI drives the deliberation by calling `delegate` and `end` tools that are registered on it. For non-Pi adapters, **the arbiter must be spawned as a CLI subprocess** (e.g., a `claude` process) that has `delegate` and `end` registered as tools it can call.

**Deliberation flow:**
1. `engine.start(briefPath)` — validates brief, initializes constraint state
2. Spawn the arbiter via `adapter.spawnAgent(arbiterConfig, sessionId)`
3. Register `delegate` and `end` as tools on the TerminalUI (via `ui.registerTool()`)
4. Set the arbiter's system prompt with resolved template (participants, constraints, output path)
5. Send kickoff message to arbiter via `adapter.sendMessage(arbiterHandle, kickoffMessage)`
6. The arbiter drives the loop: reads brief → calls `delegate(to, message)` → receives agent responses + constraint state → delegates again → eventually calls `end(closingMessage)`
7. Each `delegate` call goes through `engine.delegateMessage()` which spawns perspective agents, sends messages, tracks costs, updates constraints
8. Each `end` call triggers memo writing, session shutdown, and exits the readline loop

**Tool registration (on TerminalUI):**

`delegate` tool:
- Parameters: `to` (string | string[]), `message` (string)
- Handler: calls `engine.delegateMessage(to, message)`, returns responses + constraint state
- Same logic as Pi's delegate tool (lines 533-700 of Pi's index.ts)

`end` tool:
- Parameters: `closing_message` (string)
- Handler: calls `engine.delegateMessage("all", closingMessage)` for final statements, then triggers memo writing and session shutdown
- Same logic as Pi's end tool

**Key difference from Pi:** In Pi, tool calls happen within the same process. For CLI adapters, tool calls happen across process boundaries — the arbiter subprocess calls a tool, the adapter receives it via JSON event parsing (`tool_call` ParsedEvent), executes the handler, and returns the result. The `BaseAgentRuntime.parseEventLine()` already handles `tool_call` events and fires `eventBus.fireToolCall()`.

However, the current `sendMessage()` flow in `BaseAgentRuntime` is one-shot: spawn process, collect response, return. For multi-turn tool use, the arbiter needs to call tools and receive results within a single session. This requires that the CLI subprocess supports **agentic tool use** natively — where the CLI itself handles tool execution loops internally.

**Practical approach:** Each CLI (claude, gemini, codex) runs in its own agentic mode where it handles tool calls internally. The `delegate` and `end` tools are registered as MCP tools or CLI tools that the subprocess can call. The adapter's `sendMessage()` sends a single message and the CLI process handles the full agentic loop (multiple tool calls, multiple responses) before returning the final result.

For this to work, each CLI must support tool registration. The specific mechanism varies:
- **Claude Code:** `--allowedTools` flag + tool definitions via `--tool` or MCP
- **Gemini:** Function declarations via `--tool` flag
- **Codex:** Tool definitions via `--tool` flag or config

The `buildArgs()` method on each adapter needs to include tool registration flags when spawning the arbiter. This is an addition to the current adapter implementations — the arbiter spawn call passes tool schemas as part of the args.

The engine exposes these methods (already implemented):
- `engine.start(briefPath)` — validate and begin
- `engine.delegateMessage(to, message)` — dispatch to perspective agents
- `engine.getConstraintState()` — current constraint gauges

---

## Testing Strategy

- **Unit tests for `adapter-helpers.ts`** — test `discoverAgents()` with mock directory structures
- **Unit tests for `adapter-session.ts`** — mock adapter import, verify layer instantiation, verify command registration
- **Integration test** — run `aos run` with a test profile and mock CLI binary, verify session starts and produces output
- **Manual test** — run with each installed CLI (claude, gemini, codex) to verify end-to-end

---

## Implementation Order

1. Extract `adapter-helpers.ts` from Pi's `index.ts`
2. Update Pi's `index.ts` to import from `adapter-helpers.ts`
3. Verify Pi still works (run existing tests)
4. Implement `adapter-session.ts` — loading, instantiation, engine wiring
5. Add interactive readline loop with commands
6. Add constraint gauge rendering
7. Add `.aos/adapter.yaml` config reading
8. Wire into `run.ts` — replace "not yet supported" block
9. End-to-end test with each adapter
