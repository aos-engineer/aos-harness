# Phase 3a: Expertise & Event Summarization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents accumulate domain-specific knowledge across sessions via structured expertise files. Events get human-readable summaries via a hybrid template + batched approach.

**Architecture:** New `ExpertiseManager` module handles load/update/prune of YAML expertise files. Updates are diff-based (additions/removals per category), not full rewrites. An `auto_commit` flag controls whether updates apply immediately or require CLI confirmation. `EventSummarizer` provides template-based summaries for simple events and batches complex events for LLM summarization.

**Tech Stack:** TypeScript, Bun, js-yaml, Hono (platform API), Drizzle ORM, React

**Spec:** `docs/specs/2026-04-10-harness-enhanced-capabilities-design.md` — Sections 2 (Persistent Intelligence), 4B (Event Summarization)

---

## File Map

### Harness — New Files
| File | Responsibility |
|---|---|
| `runtime/src/expertise-manager.ts` | Load, update (diff-based), prune expertise YAML files |
| `runtime/src/event-summarizer.ts` | Template summaries for simple events, batch collection for complex |
| `runtime/tests/expertise-manager.test.ts` | Unit tests |
| `runtime/tests/event-summarizer.test.ts` | Unit tests |

### Harness — Modified Files
| File | Change |
|---|---|
| `runtime/src/types.ts` | Add `ExpertiseConfig`, `ExpertiseDiff`, `ExpertiseFile` types. Add `PersistenceAdapter` interface. |
| `runtime/src/engine.ts` | Integrate ExpertiseManager (load on start, update on end), EventSummarizer |
| `runtime/tests/mock-adapter.ts` | Add PersistenceAdapter stubs |
| `runtime/package.json` | Export new modules |

### Platform — New/Modified Files
| File | Change |
|---|---|
| `db/src/schema.ts` | Add `agentExpertise` table |
| `api/src/routes/sessions.ts` | Add `GET /api/agents/:id/expertise` endpoint |
| `api/src/services/ingestion.ts` | Handle `expertise_loaded`, `expertise_updated` events |
| `web/src/components/EventCard.tsx` | Add expertise event cards, render summaries inline |

---

## Task 1: Add Expertise & Summarization Types

**Files:**
- Modify: `runtime/src/types.ts`
- Test: `runtime/tests/types.test.ts`

- [ ] **Step 1: Write failing type tests**

Append to `runtime/tests/types.test.ts`:

```typescript
describe("Expertise & summarization types", () => {
  it("ExpertiseConfig compiles", () => {
    const config: import("../src/types").ExpertiseConfig = {
      enabled: true,
      max_lines: 5000,
      structure: ["architecture_patterns", "failure_modes"],
      read_on: "session_start",
      update_on: "session_end",
      scope: "per-project",
      mode: "read-write",
      auto_commit: "review",
    };
    expect(config.auto_commit).toBe("review");
  });

  it("ExpertiseDiff compiles", () => {
    const diff: import("../src/types").ExpertiseDiff = {
      agentId: "architect",
      projectId: "proj-abc",
      additions: { architecture_patterns: ["Uses repository pattern"] },
      removals: { failure_modes: ["Old failure mode"] },
    };
    expect(Object.keys(diff.additions)).toHaveLength(1);
  });

  it("ExpertiseFile compiles", () => {
    const file: import("../src/types").ExpertiseFile = {
      last_updated: "2026-04-10T14:30:00Z",
      session_count: 4,
      knowledge: {
        architecture_patterns: ["Repository pattern", "Middleware chain"],
        failure_modes: ["WebSocket reconnection drops"],
      },
    };
    expect(file.session_count).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test runtime/tests/types.test.ts`

- [ ] **Step 3: Add types to runtime/src/types.ts**

After the `FileChangeEvent` interface, add:

```typescript
// ── Expertise Types ────────────────────────────────────────────

export interface ExpertiseConfig {
  enabled: boolean;
  max_lines: number;
  structure: string[];
  read_on: "session_start";
  update_on: "session_end";
  scope: "per-project" | "global";
  mode: "read-write" | "read-only";
  auto_commit: "true" | "review";
}

export interface ExpertiseFile {
  last_updated: string;
  session_count: number;
  knowledge: Record<string, string[]>;
}

export interface ExpertiseDiff {
  agentId: string;
  projectId: string;
  additions: Record<string, string[]>;
  removals: Record<string, string[]>;
}

// ── Persistence Adapter (Optional Mixin) ───────────────────────

export interface PersistenceAdapter {
  persistExpertise(agentId: string, projectId: string, content: string): Promise<void>;
  loadExpertise(agentId: string, projectId: string): Promise<string | null>;
}
```

Also add `ExpertiseConfig` as an optional field on `AgentConfig`:
```typescript
  expertiseConfig?: ExpertiseConfig;  // NEW — Phase 3a expertise settings
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test runtime/tests/types.test.ts`

- [ ] **Step 5: Commit**

```bash
git add runtime/src/types.ts runtime/tests/types.test.ts
git commit -m "feat(types): add expertise and persistence types for Phase 3a"
```

---

## Task 2: Implement ExpertiseManager

**Files:**
- Create: `runtime/src/expertise-manager.ts`
- Create: `runtime/tests/expertise-manager.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// runtime/tests/expertise-manager.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { ExpertiseManager } from "../src/expertise-manager";
import type { ExpertiseFile, ExpertiseDiff } from "../src/types";

describe("ExpertiseManager", () => {
  let manager: ExpertiseManager;

  beforeEach(() => {
    manager = new ExpertiseManager();
  });

  describe("loadExpertise", () => {
    it("parses valid YAML expertise file", () => {
      const yaml = `last_updated: "2026-04-10T14:30:00Z"
session_count: 3
knowledge:
  architecture_patterns:
    - "Repository pattern with Drizzle"
    - "Middleware auth chain"
  failure_modes:
    - "WebSocket drops on restart"`;
      const result = manager.parseExpertise(yaml);
      expect(result.session_count).toBe(3);
      expect(result.knowledge.architecture_patterns).toHaveLength(2);
    });

    it("returns empty expertise for null/empty content", () => {
      const result = manager.parseExpertise(null);
      expect(result.session_count).toBe(0);
      expect(Object.keys(result.knowledge)).toHaveLength(0);
    });
  });

  describe("applyDiff", () => {
    it("adds new entries to existing categories", () => {
      const existing: ExpertiseFile = {
        last_updated: "2026-04-10",
        session_count: 2,
        knowledge: { patterns: ["A", "B"] },
      };
      const diff: ExpertiseDiff = {
        agentId: "arch", projectId: "p1",
        additions: { patterns: ["C"] },
        removals: {},
      };
      const result = manager.applyDiff(existing, diff);
      expect(result.knowledge.patterns).toEqual(["A", "B", "C"]);
      expect(result.session_count).toBe(3);
    });

    it("removes entries from existing categories", () => {
      const existing: ExpertiseFile = {
        last_updated: "2026-04-10",
        session_count: 2,
        knowledge: { patterns: ["A", "B", "C"] },
      };
      const diff: ExpertiseDiff = {
        agentId: "arch", projectId: "p1",
        additions: {},
        removals: { patterns: ["B"] },
      };
      const result = manager.applyDiff(existing, diff);
      expect(result.knowledge.patterns).toEqual(["A", "C"]);
    });

    it("creates new categories from additions", () => {
      const existing: ExpertiseFile = {
        last_updated: "2026-04-10",
        session_count: 1,
        knowledge: {},
      };
      const diff: ExpertiseDiff = {
        agentId: "arch", projectId: "p1",
        additions: { new_category: ["entry1"] },
        removals: {},
      };
      const result = manager.applyDiff(existing, diff);
      expect(result.knowledge.new_category).toEqual(["entry1"]);
    });

    it("does not add duplicates", () => {
      const existing: ExpertiseFile = {
        last_updated: "2026-04-10",
        session_count: 1,
        knowledge: { patterns: ["A"] },
      };
      const diff: ExpertiseDiff = {
        agentId: "arch", projectId: "p1",
        additions: { patterns: ["A", "B"] },
        removals: {},
      };
      const result = manager.applyDiff(existing, diff);
      expect(result.knowledge.patterns).toEqual(["A", "B"]);
    });
  });

  describe("pruneExpertise", () => {
    it("prunes oldest entries when over max_lines", () => {
      const expertise: ExpertiseFile = {
        last_updated: "2026-04-10",
        session_count: 10,
        knowledge: {
          cat_a: ["a1", "a2", "a3", "a4", "a5"],
          cat_b: ["b1", "b2", "b3", "b4", "b5"],
        },
      };
      const result = manager.pruneExpertise(expertise, 6); // max 6 total entries
      const totalEntries = Object.values(result.knowledge).flat().length;
      expect(totalEntries).toBeLessThanOrEqual(6);
    });

    it("does not prune when under limit", () => {
      const expertise: ExpertiseFile = {
        last_updated: "2026-04-10",
        session_count: 1,
        knowledge: { cat_a: ["a1", "a2"] },
      };
      const result = manager.pruneExpertise(expertise, 100);
      expect(result.knowledge.cat_a).toEqual(["a1", "a2"]);
    });
  });

  describe("serializeExpertise", () => {
    it("produces valid YAML", () => {
      const expertise: ExpertiseFile = {
        last_updated: "2026-04-10T14:30:00Z",
        session_count: 2,
        knowledge: { patterns: ["A", "B"] },
      };
      const yaml = manager.serializeExpertise(expertise);
      expect(yaml).toContain("last_updated:");
      expect(yaml).toContain("- A");
      expect(yaml).toContain("- B");
    });
  });

  describe("injectIntoPrompt", () => {
    it("formats expertise as prompt section", () => {
      const expertise: ExpertiseFile = {
        last_updated: "2026-04-10",
        session_count: 3,
        knowledge: {
          architecture_patterns: ["Repository pattern", "Middleware chain"],
        },
      };
      const prompt = manager.injectIntoPrompt(expertise);
      expect(prompt).toContain("## Prior Knowledge");
      expect(prompt).toContain("architecture_patterns");
      expect(prompt).toContain("Repository pattern");
    });

    it("returns empty string for empty expertise", () => {
      const expertise: ExpertiseFile = {
        last_updated: "", session_count: 0, knowledge: {},
      };
      expect(manager.injectIntoPrompt(expertise)).toBe("");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test runtime/tests/expertise-manager.test.ts`

- [ ] **Step 3: Implement ExpertiseManager**

```typescript
// runtime/src/expertise-manager.ts
import * as yaml from "js-yaml";
import type { ExpertiseFile, ExpertiseDiff } from "./types";

export class ExpertiseManager {
  /**
   * Parse a YAML string into an ExpertiseFile.
   * Returns empty expertise for null/undefined/empty input.
   */
  parseExpertise(content: string | null | undefined): ExpertiseFile {
    if (!content || content.trim() === "") {
      return { last_updated: "", session_count: 0, knowledge: {} };
    }
    const parsed = yaml.load(content) as Record<string, unknown>;
    return {
      last_updated: (parsed.last_updated as string) ?? "",
      session_count: (parsed.session_count as number) ?? 0,
      knowledge: (parsed.knowledge as Record<string, string[]>) ?? {},
    };
  }

  /**
   * Apply a diff to existing expertise. Additions are appended (no duplicates),
   * removals are filtered out. Session count is incremented.
   */
  applyDiff(existing: ExpertiseFile, diff: ExpertiseDiff): ExpertiseFile {
    const knowledge = { ...existing.knowledge };

    // Apply additions
    for (const [category, entries] of Object.entries(diff.additions)) {
      const current = knowledge[category] ?? [];
      const newEntries = entries.filter((e) => !current.includes(e));
      knowledge[category] = [...current, ...newEntries];
    }

    // Apply removals
    for (const [category, entries] of Object.entries(diff.removals)) {
      if (knowledge[category]) {
        knowledge[category] = knowledge[category].filter((e) => !entries.includes(e));
        if (knowledge[category].length === 0) {
          delete knowledge[category];
        }
      }
    }

    return {
      last_updated: new Date().toISOString(),
      session_count: existing.session_count + 1,
      knowledge,
    };
  }

  /**
   * Prune expertise using age-based FIFO within each category.
   * Distributes maxLines proportionally across categories,
   * then trims oldest (first) entries from categories that exceed their share.
   */
  pruneExpertise(expertise: ExpertiseFile, maxLines: number): ExpertiseFile {
    const categories = Object.keys(expertise.knowledge);
    if (categories.length === 0) return expertise;

    const totalEntries = Object.values(expertise.knowledge).flat().length;
    if (totalEntries <= maxLines) return expertise;

    const perCategory = Math.max(1, Math.floor(maxLines / categories.length));
    const knowledge: Record<string, string[]> = {};

    for (const cat of categories) {
      const entries = expertise.knowledge[cat];
      // Keep the most recent (last) entries, drop oldest (first) — FIFO
      knowledge[cat] = entries.slice(-perCategory);
    }

    return { ...expertise, knowledge };
  }

  /**
   * Serialize an ExpertiseFile to YAML string.
   */
  serializeExpertise(expertise: ExpertiseFile): string {
    return yaml.dump(expertise, { lineWidth: -1, noRefs: true });
  }

  /**
   * Format expertise as a prompt section for injection into agent context.
   */
  injectIntoPrompt(expertise: ExpertiseFile): string {
    if (expertise.session_count === 0 || Object.keys(expertise.knowledge).length === 0) {
      return "";
    }

    const lines: string[] = [
      "## Prior Knowledge",
      `_From ${expertise.session_count} previous session(s), last updated ${expertise.last_updated}_`,
      "",
    ];

    for (const [category, entries] of Object.entries(expertise.knowledge)) {
      lines.push(`### ${category.replace(/_/g, " ")}`);
      for (const entry of entries) {
        lines.push(`- ${entry}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test runtime/tests/expertise-manager.test.ts`
Expected: All PASS

- [ ] **Step 5: Export from package.json**

Add to runtime/package.json exports: `"./expertise-manager": "./src/expertise-manager.ts"`

- [ ] **Step 6: Run full suite**

Run: `bun test`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add runtime/src/expertise-manager.ts runtime/tests/expertise-manager.test.ts runtime/package.json
git commit -m "feat(runtime): implement ExpertiseManager with diff-based updates

Parses/serializes YAML expertise files. Applies diffs (additions/
removals per category) without duplicates. FIFO pruning within
categories. Formats expertise as prompt injection section."
```

---

## Task 3: Implement EventSummarizer (Template-Based)

**Files:**
- Create: `runtime/src/event-summarizer.ts`
- Create: `runtime/tests/event-summarizer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// runtime/tests/event-summarizer.test.ts
import { describe, it, expect } from "bun:test";
import { EventSummarizer } from "../src/event-summarizer";
import type { TranscriptEntry } from "../src/types";

describe("EventSummarizer — template summaries", () => {
  const summarizer = new EventSummarizer();

  it("summarizes file_changed events via template", () => {
    const event: TranscriptEntry = {
      type: "file_changed", timestamp: "2026-04-10",
      agentId: "backend-dev", path: "src/api/router.ts", operation: "modified",
    };
    const result = summarizer.templateSummary(event);
    expect(result).toBe("backend-dev modified src/api/router.ts");
  });

  it("summarizes token_usage events via template", () => {
    const event: TranscriptEntry = {
      type: "token_usage", timestamp: "2026-04-10",
      agentId: "architect", tokensIn: 500, tokensOut: 300, cost: 0.012,
    };
    const result = summarizer.templateSummary(event);
    expect(result).toContain("architect");
    expect(result).toContain("500");
  });

  it("summarizes agent_destroyed events via template", () => {
    const event: TranscriptEntry = {
      type: "agent_destroyed", timestamp: "2026-04-10",
      childAgentId: "worker-1", reason: "task_complete",
    };
    const result = summarizer.templateSummary(event);
    expect(result).toContain("worker-1");
  });

  it("summarizes constraint_check events via template", () => {
    const event: TranscriptEntry = {
      type: "constraint_check", timestamp: "2026-04-10",
      round: 3, elapsed_minutes: 5.2, budget_spent: 0.45,
    };
    const result = summarizer.templateSummary(event);
    expect(result).toContain("Round 3");
  });

  it("summarizes domain_access events via template", () => {
    const event: TranscriptEntry = {
      type: "domain_access", timestamp: "2026-04-10",
      agentId: "frontend-dev", operation: "write", path: "src/ui/Button.tsx",
    };
    const result = summarizer.templateSummary(event);
    expect(result).toContain("frontend-dev");
  });

  it("returns null for complex events that need LLM", () => {
    const event: TranscriptEntry = {
      type: "delegation", timestamp: "2026-04-10",
      agentId: "arbiter", targets: ["sentinel", "catalyst"],
    };
    expect(summarizer.templateSummary(event)).toBeNull();
  });

  it("returns null for response events", () => {
    const event: TranscriptEntry = { type: "response", timestamp: "2026-04-10", agentId: "sentinel" };
    expect(summarizer.templateSummary(event)).toBeNull();
  });

  it("identifies which events need LLM summarization", () => {
    expect(summarizer.needsLLM({ type: "delegation", timestamp: "" } as TranscriptEntry)).toBe(true);
    expect(summarizer.needsLLM({ type: "response", timestamp: "" } as TranscriptEntry)).toBe(true);
    expect(summarizer.needsLLM({ type: "domain_violation", timestamp: "" } as TranscriptEntry)).toBe(true);
    expect(summarizer.needsLLM({ type: "file_changed", timestamp: "" } as TranscriptEntry)).toBe(false);
    expect(summarizer.needsLLM({ type: "token_usage", timestamp: "" } as TranscriptEntry)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement EventSummarizer**

```typescript
// runtime/src/event-summarizer.ts
import type { TranscriptEntry } from "./types";

const TEMPLATE_TYPES = new Set([
  "file_changed", "token_usage", "domain_access", "agent_destroyed",
  "constraint_check", "agent_spawn", "agent_destroy", "session_start",
  "session_end", "session_paused", "session_resumed",
]);

const LLM_TYPES = new Set([
  "delegation", "response", "child_delegation", "child_response",
  "domain_violation", "expertise_updated", "gate_reached", "gate_result",
  "final_statement", "review_submission",
]);

export class EventSummarizer {
  /**
   * Returns a template-based summary for simple events, or null
   * if the event needs LLM summarization.
   */
  templateSummary(event: TranscriptEntry): string | null {
    switch (event.type) {
      case "file_changed":
        return `${event.agentId ?? "unknown"} ${event.operation ?? "changed"} ${event.path ?? "file"}`;

      case "token_usage":
        return `${event.agentId ?? "unknown"} used ${event.tokensIn ?? 0}+${event.tokensOut ?? 0} tokens ($${((event.cost as number) ?? 0).toFixed(4)})`;

      case "agent_destroyed":
        return `${event.childAgentId ?? "agent"} finished (${event.reason ?? "done"})`;

      case "constraint_check":
        return `Round ${event.round ?? "?"}: ${((event.elapsed_minutes as number) ?? 0).toFixed(1)}min, $${((event.budget_spent as number) ?? 0).toFixed(2)} spent`;

      case "domain_access":
        return `${event.agentId ?? "unknown"} ${event.operation ?? "accessed"} ${event.path ?? "path"}`;

      case "agent_spawn":
        return `Spawned ${event.agentId ?? "agent"}`;

      case "agent_destroy":
        return `Destroyed ${event.agentId ?? "agent"}`;

      case "session_start":
        return `Session started with profile ${event.profile ?? "unknown"}`;

      case "session_end":
        return `Session ended (${event.roundsCompleted ?? 0} rounds)`;

      case "session_paused":
        return `Session paused: ${event.reason ?? "user requested"}`;

      case "session_resumed":
        return `Session resumed from checkpoint`;

      default:
        return null;
    }
  }

  /**
   * Returns true if this event type requires LLM summarization.
   */
  needsLLM(event: TranscriptEntry): boolean {
    return LLM_TYPES.has(event.type);
  }

  /**
   * Returns true if this event type can be summarized via template.
   */
  isTemplateable(event: TranscriptEntry): boolean {
    return TEMPLATE_TYPES.has(event.type);
  }
}
```

- [ ] **Step 3: Run tests**

Run: `bun test runtime/tests/event-summarizer.test.ts`
Expected: All PASS

- [ ] **Step 4: Export and run full suite**

Add to runtime/package.json: `"./event-summarizer": "./src/event-summarizer.ts"`

Run: `bun test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/src/event-summarizer.ts runtime/tests/event-summarizer.test.ts runtime/package.json
git commit -m "feat(runtime): implement EventSummarizer with template-based summaries

Template summaries for simple events (file_changed, token_usage,
constraint_check, etc.). Identifies complex events that need LLM
summarization (delegation, response, domain_violation, etc.)."
```

---

## Task 4: Update MockAdapter with PersistenceAdapter

**Files:**
- Modify: `runtime/tests/mock-adapter.ts`
- Modify: `runtime/src/types.ts` (extend AOSAdapter type)

- [ ] **Step 1: Add PersistenceAdapter methods to MockAdapter**

Add to MockAdapter:
```typescript
  // ── PersistenceAdapter ──────────────────────────────────────────
  private expertiseStore: Map<string, string> = new Map();

  async persistExpertise(agentId: string, projectId: string, content: string): Promise<void> {
    this.record("persistExpertise", agentId, projectId);
    this.expertiseStore.set(`${agentId}:${projectId}`, content);
  }

  async loadExpertise(agentId: string, projectId: string): Promise<string | null> {
    this.record("loadExpertise", agentId, projectId);
    return this.expertiseStore.get(`${agentId}:${projectId}`) ?? null;
  }
```

Import `PersistenceAdapter` in the types import.

Note: We keep `AOSAdapter` as-is (PersistenceAdapter is an optional mixin, not required). The MockAdapter just implements it for testing convenience.

- [ ] **Step 2: Run full suite**

Run: `bun test`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add runtime/tests/mock-adapter.ts
git commit -m "test: add PersistenceAdapter methods to MockAdapter"
```

---

## Task 5: Platform — Add agent_expertise Table and Ingestion

**Files:**
- Modify: `/Users/jkolade/sireskay/github/aos-platform/db/src/schema.ts`
- Modify: `/Users/jkolade/sireskay/github/aos-platform/api/src/services/ingestion.ts`
- Create: `/Users/jkolade/sireskay/github/aos-platform/db/migrations/0004_add_agent_expertise.sql`

- [ ] **Step 1: Add table to schema**

```typescript
export const agentExpertise = pgTable("agent_expertise", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  agent_id: text("agent_id").notNull(),
  project_id: text("project_id").notNull(),
  content: jsonb("content").notNull().$type<Record<string, unknown>>(),
  entry_count: integer("entry_count").notNull().default(0),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Create migration**

```sql
CREATE TABLE IF NOT EXISTS agent_expertise (
  id BIGSERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  entry_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_expertise_agent_project ON agent_expertise(agent_id, project_id);
```

- [ ] **Step 3: Handle expertise events in ingestion**

Add to ingestion.ts:
```typescript
    if (event.type === "expertise_loaded") {
      console.log(`[expertise_loaded] agent=${event.agentId ?? event.agent_id} project=${event.projectId} entries=${event.entryCount}`);
    }

    if (event.type === "expertise_updated") {
      const agentId = (event.agentId as string) || (event.agent_id as string) || "unknown";
      const projectId = (event.projectId as string) || "unknown";
      const additions = (event.additions as string[]) || [];
      const removals = (event.removals as string[]) || [];
      console.log(`[expertise_updated] agent=${agentId} project=${projectId} +${additions.length} -${removals.length}`);
    }
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jkolade/sireskay/github/aos-platform
git add db/src/schema.ts db/migrations/0004_add_agent_expertise.sql api/src/services/ingestion.ts
git commit -m "feat: add agent_expertise table and handle expertise events in ingestion"
```

---

## Task 6: Platform — Add Expertise EventCards and Summary Display

**Files:**
- Modify: `/Users/jkolade/sireskay/github/aos-platform/web/src/components/EventCard.tsx`

- [ ] **Step 1: Add expertise event cards and summary rendering**

Add cards for expertise_loaded and expertise_updated before the generic fallback:

```tsx
  if (event_type === "expertise_loaded") {
    const agentColor = getAgentColor(agent_id);
    const entries = (payload.entryCount as number) ?? 0;
    const lastUpdated = (payload.lastUpdated as string) ?? "";
    return (
      <div style={{ ...cardBase, borderLeftColor: "#06B6D4" }}>
        <div style={headerStyle}>
          <AgentDot color={agentColor} />
          <span style={{ color: agentColor }}>{agent_id ?? "unknown"}</span>
          <span style={{ color: "#06B6D4" }}>EXPERTISE</span>
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          Loaded {entries} knowledge entries (last updated {lastUpdated || "never"})
        </div>
      </div>
    );
  }

  if (event_type === "expertise_updated") {
    const agentColor = getAgentColor(agent_id);
    const additions = (payload.additions as string[]) ?? [];
    const removals = (payload.removals as string[]) ?? [];
    return (
      <div style={{ ...cardBase, borderLeftColor: "#06B6D4" }}>
        <div style={headerStyle}>
          <AgentDot color={agentColor} />
          <span style={{ color: agentColor }}>{agent_id ?? "unknown"}</span>
          <span style={{ color: "#06B6D4" }}>EXPERTISE UPDATE</span>
        </div>
        <div style={{ color: "var(--text-primary)", fontSize: 12 }}>
          {additions.length > 0 && <span style={{ color: "#10B981" }}>+{additions.length} added </span>}
          {removals.length > 0 && <span style={{ color: "#EF4444" }}>-{removals.length} removed</span>}
        </div>
      </div>
    );
  }
```

Also add inline summary rendering to ALL event cards. In the generic fallback card, check for a `summary` field in the event payload and render it:

At the top of the EventCard function, extract summary:
```typescript
const summary = (event as any).summary as string | undefined;
```

Then in each card, after the existing content, add an optional summary line:
```tsx
{summary && <div style={{ color: "var(--text-secondary)", fontSize: 11, fontStyle: "italic", marginTop: 2 }}>{summary}</div>}
```

Add this to the generic fallback card only (other cards have their own specific content).

- [ ] **Step 2: Commit**

```bash
cd /Users/jkolade/sireskay/github/aos-platform
git add web/src/components/EventCard.tsx
git commit -m "feat(web): add expertise EventCards and summary display"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run harness tests**

Run: `cd /Users/jkolade/sireskay/github/aos-harness && bun test`
Expected: All tests PASS

- [ ] **Step 2: Check platform**

Run: `cd /Users/jkolade/sireskay/github/aos-platform && git status`
Expected: Clean

- [ ] **Step 3: Verify commit history**

Both repos should have clean, sequential commit history.
