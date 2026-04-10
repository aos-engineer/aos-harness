# Session Resumption

Sessions can be paused at any point and resumed later with full agent context intact. When a session resumes, each agent wakes up with a curated tail of recent transcript events covering its own activity, so it can continue reasoning without starting from scratch.

Resumption is designed for long-running deliberations that span multiple work sessions, for situations where a session must be suspended due to budget or time constraints, and for human-in-the-loop workflows where a gate decision requires an overnight review.

## How Checkpoints Work

When the engine pauses a session, it serializes a `SessionCheckpoint` that captures everything needed to restore the session to a running state.

### SessionCheckpoint

| Field | Type | Description |
|---|---|---|
| `sessionId` | string | Identifier of the paused session |
| `constraintState` | object | Budget spent, rounds completed, and time elapsed at pause time |
| `activeAgents` | AgentCheckpoint[] | One checkpoint record per agent that was running |
| `roundsCompleted` | number | Total deliberation rounds completed before pause |
| `pendingDelegations` | object[] | Delegations that were in flight at pause time |
| `transcriptReplayDepth` | number | How many tail events to replay per agent on resume |
| `createdAt` | string | ISO timestamp of when the checkpoint was written |

### AgentCheckpoint

| Field | Type | Description |
|---|---|---|
| `agentId` | string | The agent's unique identifier |
| `parentAgentId` | string \| undefined | Set for child agents in a hierarchical delegation tree |
| `depth` | number | Nesting depth (0 for top-level perspective agents) |
| `conversationTail` | TranscriptEvent[] | The last N transcript events where this agent was involved |
| `expertiseSnapshot` | string \| undefined | Full contents of the agent's scratch pad at pause time |

The checkpoint is stored as a JSON blob associated with the session record. Only one checkpoint exists per session at a time -- pausing again overwrites the previous checkpoint.

## Per-Agent Conversation Tails

Each agent receives its own filtered slice of the transcript, not a copy of the full session history. The tail contains the last N events where the agent was meaningfully involved.

An event is included in an agent's tail if any of the following are true:

- The event's `agentId` matches this agent
- The event's `childAgentId` matches this agent
- The event is a delegation whose target is this agent

The default tail depth is 50 events. This is configurable via `transcriptReplayDepth` in the execution profile. Shorter tails reduce prompt size and cost on resume; longer tails preserve more deliberation nuance.

The filtering ensures agents do not receive unrelated content from other agents' delegations or file operations. A cost analyst agent waking up after a pause sees its own reasoning history, not the legal agent's domain access log.

## Pause/Resume Flow

### Pausing

1. `Engine.pauseSession()` is called -- either by the harness when a constraint is hit, by a gate result, or by an explicit API call.
2. The engine captures current constraint state (budget spent, rounds completed, elapsed time) and collects handles for all active agents.
3. Per-agent conversation tails are extracted by filtering the full transcript for each agent's involvement.
4. Each agent's expertise scratch pad is read and stored in the corresponding `AgentCheckpoint`.
5. The `SessionCheckpoint` is serialized and written to the session store.
6. A `session_paused` transcript event is emitted with the checkpoint timestamp.
7. All agent processes are torn down cleanly.

### Resuming

1. The resume API call loads the `SessionCheckpoint` for the given session ID.
2. Agents listed in `activeAgents` are re-spawned using the same agent definitions and model configuration as the original session.
3. Expertise scratch pads are reloaded from `expertiseSnapshot` so each agent's memory is current.
4. Each agent's `conversationTail` is replayed into its context as a structured prompt section:

```
## Session Context (Resumed)

This session was paused and has now resumed. Below is a summary of recent activity
you were involved in before the pause.

[Filtered transcript tail for this agent]
```

5. The orchestrator resumes from the round where the session left off, using `roundsCompleted` from the checkpoint.
6. A `session_resumed` transcript event is emitted.

## Constraint Behavior

Constraint handling differs across the three tracked dimensions when a session resumes:

| Constraint | Behavior on resume |
|---|---|
| Time elapsed | Resets to zero -- the clock starts fresh from the moment of resume |
| Budget spent | Continues from checkpoint value -- cumulative spend is preserved |
| Rounds | Continues from checkpoint value -- no rounds are credited for free |

This design means a session paused at $4.80 of a $5.00 budget resumes with only $0.20 remaining, but a session paused after 45 minutes of a 60-minute limit gets a full fresh 60 minutes on resume. Time limits are intended to bound individual working sessions, not total calendar time.

## Limitations

**Agent context window is not preserved.** Only the conversation tail is replayed. The full internal context the LLM held at pause time -- intermediate reasoning chains, cached attention -- is gone. The replay prompt reconstructs working context as accurately as possible, but very long chains of reasoning within a single round may not fully survive a pause.

**Long sessions may lose nuance.** The tail depth is a fixed window. A session with 200 rounds of dense deliberation will have its early reasoning compressed to whatever fits in the tail. For sessions expected to run long, increase `transcriptReplayDepth` in the execution profile.

**Replay depth is configurable per profile.** Set `transcriptReplayDepth` in the execution profile's constraint block:

```yaml
constraints:
  transcriptReplayDepth: 100  # default: 50
```

Higher values improve resume fidelity at the cost of larger prompts and higher token spend on the first resumed round.
