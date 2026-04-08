# AOS Platform Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time observability dashboard where engineers can watch multi-agent deliberations live in a browser, backed by a Hono API + PostgreSQL, consuming events from the AOS Harness engine via an event hook.

**Architecture:** Two repos — the open-source `aos-harness` gets a small event hook addition, and the new private `aos-platform` repo holds the Hono API, Drizzle/PostgreSQL schema, and React SPA dashboard. Events flow: Engine → HTTP POST batch → API ingests + persists + broadcasts via WebSocket → Browser renders live.

**Tech Stack:** Hono (Bun), PostgreSQL + Drizzle ORM, React + TanStack Router + TanStack Query, Vite+ toolchain, WebSocket for real-time streaming.

**Spec:** `docs/specs/2026-03-27-aos-platform-observability-design.md`

---

## File Structure

### aos-harness (existing repo — 3 files modified)

```
runtime/src/engine.ts              — Add onTranscriptEvent hook to EngineOpts + pushTranscript
runtime/src/types.ts               — Export TranscriptEntry type (already exported, verify)
cli/src/commands/run.ts            — Add --platform-url flag, wire event buffer
```

### aos-platform (new private repo)

```
package.json                       — Bun workspace root
bunfig.toml                        — Bun config
docker-compose.yml                 — PostgreSQL + API for local dev
.gitignore

shared/
├── package.json
├── src/
│   ├── types.ts                   — SessionConstraints, TranscriptEventType, ModelTierMap, API types
│   └── index.ts                   — Barrel export

db/
├── package.json
├── drizzle.config.ts              — Drizzle Kit config
├── src/
│   ├── schema.ts                  — sessions, transcript_events, cost_records tables
│   ├── index.ts                   — DB connection + Drizzle instance
│   └── migrate.ts                 — Migration runner script

api/
├── package.json
├── src/
│   ├── index.ts                   — Hono app entry, CORS, routes
│   ├── routes/
│   │   ├── events.ts              — POST /api/sessions/:id/events (ingestion)
│   │   ├── sessions.ts            — GET /api/sessions, GET /api/sessions/:id, transcript, costs
│   │   └── analytics.ts           — GET /api/analytics/costs, profiles
│   ├── ws/
│   │   └── hub.ts                 — WebSocket hub (session + feed channels)
│   └── services/
│       └── ingestion.ts           — Event processing: validate, persist, extract costs, broadcast
├── tests/
│   ├── ingestion.test.ts          — Event ingestion pipeline tests
│   ├── sessions.test.ts           — Session CRUD endpoint tests
│   └── ws.test.ts                 — WebSocket broadcast tests

web/
├── package.json
├── index.html                     — SPA entry
├── src/
│   ├── main.tsx                   — React root + TanStack Router
│   ├── router.ts                  — Route definitions
│   ├── api/
│   │   ├── client.ts              — Fetch wrapper for Hono API
│   │   └── ws.ts                  — WebSocket client + TanStack Query integration
│   ├── hooks/
│   │   ├── useSession.ts          — Session data hook (REST + WebSocket)
│   │   └── useSessions.ts         — Session list hook
│   ├── components/
│   │   ├── Sidebar.tsx            — Logo, nav, agent roster
│   │   ├── TopBar.tsx             — Live badge, session title, stats
│   │   ├── EventStream.tsx        — Scrolling event feed
│   │   ├── EventCard.tsx          — Individual event rendering (delegation, response, check)
│   │   ├── ConstraintPanel.tsx    — Gauges, bias, session info
│   │   ├── ConstraintGauge.tsx    — Single gauge bar component
│   │   └── AgentDot.tsx           — Color-coded status dot
│   ├── pages/
│   │   ├── LiveSession.tsx        — Three-zone live session page
│   │   └── SessionList.tsx        — Session history table
│   └── styles/
│       └── global.css             — Terminal Minimal design tokens
```

---

## Part A: Framework Changes (aos-harness repo)

### Task 1: Add onTranscriptEvent hook to AOSEngine

**Files:**
- Modify: `runtime/src/engine.ts:33-38` (EngineOpts interface)
- Modify: `runtime/src/engine.ts:546-549` (pushTranscript method)
- Test: `runtime/tests/engine.test.ts`

- [ ] **Step 1: Write the failing test**

In `runtime/tests/engine.test.ts`, add a test for the event hook:

```typescript
describe("onTranscriptEvent hook", () => {
  it("calls the hook for each transcript event", async () => {
    const events: TranscriptEntry[] = [];
    const hook = (entry: TranscriptEntry) => { events.push(entry); };

    const engine = new AOSEngine(mockAdapter, profilePath, {
      agentsDir,
      onTranscriptEvent: hook,
    });

    engine.pushTranscript({ type: "session_start", timestamp: new Date().toISOString(), session_id: "test-123", profile: "test", domain: null, participants: [], constraints: {}, auth_mode: { type: "unknown", metered: false }, brief_path: "/test" });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("session_start");
  });

  it("does not throw when hook throws", () => {
    const hook = () => { throw new Error("hook error"); };

    const engine = new AOSEngine(mockAdapter, profilePath, {
      agentsDir,
      onTranscriptEvent: hook,
    });

    expect(() => {
      engine.pushTranscript({ type: "session_start", timestamp: new Date().toISOString(), session_id: "test-123", profile: "test", domain: null, participants: [], constraints: {}, auth_mode: { type: "unknown", metered: false }, brief_path: "/test" });
    }).not.toThrow();
  });

  it("swallows async hook rejections", async () => {
    const hook = async () => { throw new Error("async hook error"); };

    const engine = new AOSEngine(mockAdapter, profilePath, {
      agentsDir,
      onTranscriptEvent: hook,
    });

    expect(() => {
      engine.pushTranscript({ type: "session_start", timestamp: new Date().toISOString(), session_id: "test-123", profile: "test", domain: null, participants: [], constraints: {}, auth_mode: { type: "unknown", metered: false }, brief_path: "/test" });
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd runtime && bun test tests/engine.test.ts`
Expected: FAIL — `onTranscriptEvent` not recognized in EngineOpts

- [ ] **Step 3: Add onTranscriptEvent to EngineOpts and constructor**

In `runtime/src/engine.ts`, update the `EngineOpts` interface:

```typescript
export interface EngineOpts {
  agentsDir: string;
  domain?: string;
  domainDir?: string;
  workflowsDir?: string;
  onTranscriptEvent?: (entry: TranscriptEntry) => void | Promise<void>;
}
```

Store it in the constructor:

```typescript
private onTranscriptEvent?: (entry: TranscriptEntry) => void | Promise<void>;

constructor(adapter: AOSAdapter, profilePath: string, opts: EngineOpts) {
  // ... existing code ...
  this.onTranscriptEvent = opts.onTranscriptEvent;
}
```

- [ ] **Step 4: Update pushTranscript to call the hook**

In `runtime/src/engine.ts`, replace the `pushTranscript` method:

```typescript
pushTranscript(entry: TranscriptEntry): void {
  this.transcript.push(entry);
  if (this.onTranscriptEvent) {
    try {
      const result = this.onTranscriptEvent(entry);
      if (result instanceof Promise) {
        result.catch(() => {});
      }
    } catch {
      // Silent failure — platform observability must never block deliberation
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd runtime && bun test tests/engine.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite**

Run: `cd runtime && bun test`
Expected: All 194+ tests PASS (no regressions)

- [ ] **Step 7: Commit**

```bash
git add runtime/src/engine.ts runtime/tests/engine.test.ts
git commit -m "feat(runtime): add onTranscriptEvent hook for platform observability"
```

---

### Task 2: Add --platform-url flag to CLI run command

**Files:**
- Modify: `cli/src/commands/run.ts`
- No separate test file — integration tested via the platform end-to-end

- [ ] **Step 1: Add --platform-url to HELP text and flag parsing**

In `cli/src/commands/run.ts`, add to the HELP string after the `--workflow-dir` line:

```typescript
  --platform-url <url> Platform API URL for live observability (e.g. http://localhost:3001)
```

- [ ] **Step 2: Add event buffer implementation**

Add a new function at the top of `cli/src/commands/run.ts` (after imports):

```typescript
import type { TranscriptEntry } from "../../../runtime/src/types";

function createEventBuffer(platformUrl: string, sessionId: string) {
  const buffer: TranscriptEntry[] = [];
  const FLUSH_INTERVAL = 500;
  const BATCH_SIZE = 20;
  const TIMEOUT_MS = 2000;

  async function flush() {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, BATCH_SIZE);
    try {
      await fetch(`${platformUrl}/api/sessions/${sessionId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // Drop silently in Phase 1
    }
  }

  const interval = setInterval(flush, FLUSH_INTERVAL);

  return {
    enqueue(entry: TranscriptEntry) {
      buffer.push(entry);
      if (buffer.length >= BATCH_SIZE) flush();
    },
    async shutdown() {
      clearInterval(interval);
      await flush(); // Final flush
    },
  };
}
```

- [ ] **Step 3: Wire the flag to the engine via environment variable**

In the Pi adapter launch section of `run.ts`, after the existing env setup, add:

```typescript
const platformUrl = (args.flags["platform-url"] as string) || null;
if (platformUrl) {
  env.AOS_PLATFORM_URL = platformUrl;
}
```

- [ ] **Step 4: Add .aos/config.yaml platform support**

In the adapter config loading section, after reading adapter config, add:

```typescript
if (!platformUrl && config?.platform?.enabled && config?.platform?.url) {
  env.AOS_PLATFORM_URL = config.platform.url;
}
```

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/run.ts
git commit -m "feat(cli): add --platform-url flag for live observability streaming"
```

---

## Part B: Platform Repo Setup (aos-platform — new repo)

### Task 3: Initialize the aos-platform repo and workspace

**Files:**
- Create: `package.json`, `bunfig.toml`, `.gitignore`, `docker-compose.yml`
- Create: `shared/package.json`, `shared/src/types.ts`, `shared/src/index.ts`
- Create: `db/package.json`, `api/package.json`, `web/package.json`

- [ ] **Step 1: Create the repo and initialize**

```bash
mkdir -p ~/sireskay/github/aos-platform
cd ~/sireskay/github/aos-platform
git init
```

- [ ] **Step 2: Create root package.json (Bun workspaces)**

```json
{
  "name": "aos-platform",
  "private": true,
  "workspaces": ["shared", "db", "api", "web"],
  "scripts": {
    "dev": "bun run --filter '*' dev",
    "dev:api": "bun run --filter api dev",
    "dev:web": "bun run --filter web dev"
  }
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
.env
*.db
.superpowers/
```

- [ ] **Step 4: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_USER: aos
      POSTGRES_PASSWORD: aos_dev
      POSTGRES_DB: aos_platform
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 5: Create shared/package.json**

```json
{
  "name": "@aos-platform/shared",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 6: Create shared/src/types.ts**

```typescript
// ── Event Types ──────────────────────────────────────────────────

export type TranscriptEventType =
  | "session_start" | "agent_spawn" | "delegation" | "response"
  | "constraint_check" | "constraint_warning" | "error"
  | "budget_estimate" | "end_session" | "final_statement"
  | "session_end" | "agent_destroy" | "expertise_write"
  | "gate_result" | "review_submission" | "workflow_step";

export type SessionStatus = "running" | "completed" | "failed" | "aborted";
export type SessionType = "deliberation" | "execution";

// ── Constraint Schema ────────────────────────────────────────────

export interface SessionConstraints {
  time: { min_minutes: number; max_minutes: number };
  budget: { min: number; max: number; currency: string } | null;
  rounds: { min: number; max: number };
  bias_limit: number;
}

// ── Model Tier Mapping ───────────────────────────────────────────

export const MODEL_TIER_MAP: Record<string, string[]> = {
  economy: ["claude-haiku-4-5", "gemini-2.0-flash", "gpt-4o-mini"],
  standard: ["claude-sonnet-4-6", "gemini-2.5-pro", "gpt-4o"],
  premium: ["claude-opus-4-6", "o3", "gemini-2.5-pro-thinking"],
};

// ── API Request/Response Types ───────────────────────────────────

export interface IngestEventPayload {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface SessionSummary {
  id: string;
  profile_id: string;
  domain_id: string | null;
  session_type: SessionType;
  status: SessionStatus;
  participants: string[];
  total_cost: number;
  rounds_completed: number;
  started_at: string;
  ended_at: string | null;
}

export interface SessionDetail extends SessionSummary {
  brief_content: string;
  constraints: SessionConstraints;
  agent_costs: Record<string, number>;
}

export interface TranscriptEvent {
  id: number;
  session_id: string;
  event_type: string;
  agent_id: string | null;
  round: number | null;
  payload: Record<string, unknown>;
  created_at: string;
}
```

- [ ] **Step 7: Create shared/src/index.ts**

```typescript
export * from "./types";
```

- [ ] **Step 8: Create placeholder package.json files for db, api, web**

`db/package.json`:
```json
{
  "name": "@aos-platform/db",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "@aos-platform/shared": "workspace:*",
    "drizzle-orm": "^0.38.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.0"
  }
}
```

`api/package.json`:
```json
{
  "name": "@aos-platform/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "bun run --watch src/index.ts"
  },
  "dependencies": {
    "@aos-platform/shared": "workspace:*",
    "@aos-platform/db": "workspace:*",
    "hono": "^4.7.0"
  }
}
```

`web/package.json`:
```json
{
  "name": "@aos-platform/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "bunx vite",
    "build": "bunx vite build"
  },
  "dependencies": {
    "@aos-platform/shared": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tanstack/react-router": "^1.120.0",
    "@tanstack/react-query": "^5.75.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "vite": "^6.3.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 9: Install dependencies**

```bash
cd ~/sireskay/github/aos-platform
bun install
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: initialize aos-platform workspace with shared types, docker-compose"
```

---

### Task 4: Database schema with Drizzle

**Files:**
- Create: `db/src/schema.ts`
- Create: `db/src/index.ts`
- Create: `db/src/migrate.ts`
- Create: `db/drizzle.config.ts`

- [ ] **Step 1: Create db/drizzle.config.ts**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://aos:aos_dev@127.0.0.1:5432/aos_platform",
  },
});
```

- [ ] **Step 2: Create db/src/schema.ts**

```typescript
import { pgTable, uuid, text, timestamp, jsonb, bigserial, integer, decimal } from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: text("profile_id").notNull(),
  domain_id: text("domain_id"),
  session_type: text("session_type").notNull().$type<"deliberation" | "execution">(),
  status: text("status").notNull().$type<"running" | "completed" | "failed" | "aborted">().default("running"),
  participants: text("participants").array().notNull().default([]),
  brief_content: text("brief_content").notNull().default(""),
  constraints: jsonb("constraints").$type<import("@aos-platform/shared").SessionConstraints>(),
  total_cost: decimal("total_cost", { precision: 10, scale: 4 }).notNull().default("0"),
  rounds_completed: integer("rounds_completed").notNull().default(0),
  started_at: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  ended_at: timestamp("ended_at", { withTimezone: true }),
});

export const transcriptEvents = pgTable("transcript_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  session_id: uuid("session_id").notNull().references(() => sessions.id),
  event_type: text("event_type").notNull(),
  agent_id: text("agent_id"),
  round: integer("round"),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const costRecords = pgTable("cost_records", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  session_id: uuid("session_id").notNull().references(() => sessions.id),
  agent_id: text("agent_id").notNull(),
  round: integer("round").notNull(),
  tokens_in: integer("tokens_in").notNull().default(0),
  tokens_out: integer("tokens_out").notNull().default(0),
  cost: decimal("cost", { precision: 10, scale: 4 }).notNull().default("0"),
  model_tier: text("model_tier").notNull().default("standard"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Create db/src/index.ts**

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL || "postgresql://aos:aos_dev@127.0.0.1:5432/aos_platform";
const client = postgres(connectionString);
export const db = drizzle(client, { schema });
export { schema };
```

- [ ] **Step 4: Create db/src/migrate.ts**

```typescript
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index";

async function main() {
  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./migrations" });
  console.log("Migrations complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
```

- [ ] **Step 5: Start PostgreSQL and generate + run migrations**

```bash
cd ~/sireskay/github/aos-platform
docker compose up -d postgres
cd db
bunx drizzle-kit generate
bun run src/migrate.ts
```

Expected: Tables `sessions`, `transcript_events`, `cost_records` created.

- [ ] **Step 6: Add indexes manually (Drizzle doesn't auto-generate these)**

Create `db/migrations/0001_add_indexes.sql`:

```sql
CREATE INDEX IF NOT EXISTS idx_transcript_events_session_time ON transcript_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_records_session_agent ON cost_records(session_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_profile_status ON sessions(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
```

Run: `bun run src/migrate.ts`

- [ ] **Step 7: Commit**

```bash
cd ~/sireskay/github/aos-platform
git add db/
git commit -m "feat(db): add Drizzle schema with sessions, events, cost_records tables"
```

---

### Task 5: Hono API — event ingestion + WebSocket hub

**Files:**
- Create: `api/src/index.ts`
- Create: `api/src/services/ingestion.ts`
- Create: `api/src/ws/hub.ts`
- Create: `api/src/routes/events.ts`
- Test: `api/tests/ingestion.test.ts`

- [ ] **Step 1: Create the WebSocket hub**

Create `api/src/ws/hub.ts`:

```typescript
type WsClient = { send: (data: string) => void; close: () => void };

class WebSocketHub {
  private sessionClients = new Map<string, Set<WsClient>>();
  private feedClients = new Set<WsClient>();

  subscribeSession(sessionId: string, ws: WsClient) {
    if (!this.sessionClients.has(sessionId)) {
      this.sessionClients.set(sessionId, new Set());
    }
    this.sessionClients.get(sessionId)!.add(ws);
    return () => {
      this.sessionClients.get(sessionId)?.delete(ws);
    };
  }

  subscribeFeed(ws: WsClient) {
    this.feedClients.add(ws);
    return () => {
      this.feedClients.delete(ws);
    };
  }

  broadcast(sessionId: string, event: Record<string, unknown>) {
    const data = JSON.stringify(event);
    const sessionSubs = this.sessionClients.get(sessionId);
    if (sessionSubs) {
      for (const ws of sessionSubs) {
        try { ws.send(data); } catch { sessionSubs.delete(ws); }
      }
    }
    for (const ws of this.feedClients) {
      try { ws.send(data); } catch { this.feedClients.delete(ws); }
    }
  }
}

export const hub = new WebSocketHub();
```

- [ ] **Step 2: Create the ingestion service**

Create `api/src/services/ingestion.ts`:

```typescript
import { db, schema } from "@aos-platform/db";
import { eq, sql } from "drizzle-orm";
import type { IngestEventPayload } from "@aos-platform/shared";
import { hub } from "../ws/hub";

export async function ingestEvents(sessionId: string, events: IngestEventPayload[]) {
  for (const event of events) {
    // Upsert session on session_start
    if (event.type === "session_start") {
      await db.insert(schema.sessions).values({
        id: sessionId,
        profile_id: (event.profile as string) || "unknown",
        domain_id: (event.domain as string) || null,
        session_type: "deliberation",
        status: "running",
        participants: (event.participants as string[]) || [],
        brief_content: "",
        constraints: event.constraints as any || null,
        started_at: new Date(event.timestamp),
      }).onConflictDoNothing();
    }

    // Insert transcript event
    const [inserted] = await db.insert(schema.transcriptEvents).values({
      session_id: sessionId,
      event_type: event.type,
      agent_id: (event.agentId as string) || (event.agent_id as string) || null,
      round: (event.round as number) || null,
      payload: event,
      created_at: new Date(event.timestamp),
    }).returning();

    // Extract cost from response events
    if (event.type === "response" && typeof event.cost === "number" && event.cost > 0) {
      await db.insert(schema.costRecords).values({
        session_id: sessionId,
        agent_id: (event.agentId as string) || (event.agent_id as string) || "unknown",
        round: (event.round as number) || 0,
        tokens_in: (event.tokensIn as number) || 0,
        tokens_out: (event.tokensOut as number) || 0,
        cost: String(event.cost),
        model_tier: (event.modelTier as string) || "standard",
      });

      // Update session running totals
      await db.update(schema.sessions)
        .set({
          total_cost: sql`${schema.sessions.total_cost} + ${String(event.cost)}`,
          rounds_completed: sql`GREATEST(${schema.sessions.rounds_completed}, ${(event.round as number) || 0})`,
        })
        .where(eq(schema.sessions.id, sessionId));
    }

    // Update session status on end
    if (event.type === "session_end") {
      await db.update(schema.sessions)
        .set({
          status: "completed",
          ended_at: new Date(event.timestamp),
          rounds_completed: (event.roundsCompleted as number) || 0,
        })
        .where(eq(schema.sessions.id, sessionId));
    }

    // Broadcast to WebSocket subscribers
    hub.broadcast(sessionId, { ...inserted, session_id: sessionId });
  }
}
```

- [ ] **Step 3: Create the events route**

Create `api/src/routes/events.ts`:

```typescript
import { Hono } from "hono";
import { ingestEvents } from "../services/ingestion";
import type { IngestEventPayload } from "@aos-platform/shared";

const events = new Hono();

events.post("/sessions/:id/events", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json<IngestEventPayload[]>();

  if (!Array.isArray(body) || body.length === 0) {
    return c.json({ error: "Expected non-empty array of events" }, 400);
  }

  await ingestEvents(sessionId, body);
  return c.json({ ingested: body.length }, 200);
});

export { events };
```

- [ ] **Step 4: Create the Hono app entry**

Create `api/src/index.ts`:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { events } from "./routes/events";
import { hub } from "./ws/hub";

const app = new Hono();

app.use("*", cors({ origin: "http://localhost:5173" }));

app.route("/api", events);

// WebSocket: per-session stream
app.get("/ws/sessions/:id", (c) => {
  const sessionId = c.req.param("id");
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.text("Expected WebSocket", 426);
  }
  const server = Bun.serve; // Handled by Bun's native WebSocket
  // WebSocket upgrade is handled at the Bun.serve level (see below)
  return c.text("WebSocket upgrade handled by Bun.serve", 200);
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

const PORT = Number(process.env.PORT) || 3001;

export default {
  port: PORT,
  hostname: "127.0.0.1",
  fetch: app.fetch,
  websocket: {
    open(ws: any) {
      const url = new URL(ws.data?.url || "", "http://localhost");
      const path = url.pathname;

      if (path.startsWith("/ws/sessions/")) {
        const sessionId = path.replace("/ws/sessions/", "");
        ws.data.unsubscribe = hub.subscribeSession(sessionId, ws);
      } else if (path === "/ws/feed") {
        ws.data.unsubscribe = hub.subscribeFeed(ws);
      }
    },
    message() {},
    close(ws: any) {
      ws.data?.unsubscribe?.();
    },
  },
};

console.log(`AOS Platform API running on http://127.0.0.1:${PORT}`);
```

- [ ] **Step 5: Write ingestion test**

Create `api/tests/ingestion.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";

describe("event ingestion endpoint", () => {
  const API_URL = "http://127.0.0.1:3001";

  it("rejects non-array body", async () => {
    const res = await fetch(`${API_URL}/api/sessions/test-1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session_start" }),
    });
    expect(res.status).toBe(400);
  });

  it("ingests a batch of events", async () => {
    const events = [
      { type: "session_start", timestamp: new Date().toISOString(), profile: "strategic-council", domain: "saas", participants: ["arbiter", "catalyst", "sentinel"], constraints: { time: { min_minutes: 2, max_minutes: 10 }, budget: null, rounds: { min: 2, max: 8 }, bias_limit: 5 } },
      { type: "delegation", timestamp: new Date().toISOString(), round: 1, message: "test delegation" },
    ];

    const res = await fetch(`${API_URL}/api/sessions/test-ingest-1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(events),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ingested).toBe(2);
  });
});
```

- [ ] **Step 6: Start API and run tests**

```bash
cd ~/sireskay/github/aos-platform
docker compose up -d postgres
cd api && bun run src/index.ts &
cd ../api && bun test tests/ingestion.test.ts
```

Expected: Both tests PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/sireskay/github/aos-platform
git add api/
git commit -m "feat(api): add event ingestion endpoint, WebSocket hub, Hono server"
```

---

### Task 6: Session REST endpoints

**Files:**
- Create: `api/src/routes/sessions.ts`
- Modify: `api/src/index.ts` (add route)
- Test: `api/tests/sessions.test.ts`

- [ ] **Step 1: Create sessions route**

Create `api/src/routes/sessions.ts`:

```typescript
import { Hono } from "hono";
import { db, schema } from "@aos-platform/db";
import { eq, desc, sql, and, gt } from "drizzle-orm";

const sessions = new Hono();

// List sessions
sessions.get("/sessions", async (c) => {
  const profileFilter = c.req.query("profile");
  const statusFilter = c.req.query("status");

  let query = db.select().from(schema.sessions).orderBy(desc(schema.sessions.started_at)).limit(50);

  if (profileFilter) {
    query = query.where(eq(schema.sessions.profile_id, profileFilter)) as any;
  }

  const rows = await query;
  return c.json(rows);
});

// Session detail with per-agent cost summary
sessions.get("/sessions/:id", async (c) => {
  const sessionId = c.req.param("id");

  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
  if (!session) return c.json({ error: "Session not found" }, 404);

  const agentCosts = await db.select({
    agent_id: schema.costRecords.agent_id,
    total_cost: sql<number>`SUM(${schema.costRecords.cost})::numeric`,
  })
    .from(schema.costRecords)
    .where(eq(schema.costRecords.session_id, sessionId))
    .groupBy(schema.costRecords.agent_id);

  const agent_costs: Record<string, number> = {};
  for (const row of agentCosts) {
    agent_costs[row.agent_id] = Number(row.total_cost);
  }

  return c.json({ ...session, agent_costs });
});

// Session transcript (supports ?after_id=N for WebSocket catch-up)
sessions.get("/sessions/:id/transcript", async (c) => {
  const sessionId = c.req.param("id");
  const afterId = c.req.query("after_id");

  let conditions = [eq(schema.transcriptEvents.session_id, sessionId)];
  if (afterId) {
    conditions.push(gt(schema.transcriptEvents.id, Number(afterId)));
  }

  const events = await db.select()
    .from(schema.transcriptEvents)
    .where(and(...conditions))
    .orderBy(schema.transcriptEvents.id);

  return c.json(events);
});

// Session cost breakdown
sessions.get("/sessions/:id/costs", async (c) => {
  const sessionId = c.req.param("id");

  const costs = await db.select()
    .from(schema.costRecords)
    .where(eq(schema.costRecords.session_id, sessionId))
    .orderBy(schema.costRecords.round, schema.costRecords.agent_id);

  return c.json(costs);
});

export { sessions };
```

- [ ] **Step 2: Register route in api/src/index.ts**

Add after the events route:

```typescript
import { sessions } from "./routes/sessions";
app.route("/api", sessions);
```

- [ ] **Step 3: Write session endpoint tests**

Create `api/tests/sessions.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";

const API_URL = "http://127.0.0.1:3001";

describe("session endpoints", () => {
  it("lists sessions", async () => {
    const res = await fetch(`${API_URL}/api/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("returns 404 for unknown session", async () => {
    const res = await fetch(`${API_URL}/api/sessions/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
  });

  it("returns transcript with after_id filter", async () => {
    const res = await fetch(`${API_URL}/api/sessions/test-ingest-1/transcript?after_id=0`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd api && bun test tests/sessions.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/sessions.ts api/src/index.ts api/tests/sessions.test.ts
git commit -m "feat(api): add session list, detail, transcript, cost endpoints"
```

---

### Task 7: React SPA scaffolding with TanStack Router

**Files:**
- Create: `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`
- Create: `web/src/main.tsx`, `web/src/router.ts`
- Create: `web/src/styles/global.css`
- Create: `web/src/api/client.ts`, `web/src/api/ws.ts`

- [ ] **Step 1: Create web/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AOS Platform</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=IBM+Plex+Mono:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: Create web/vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
```

- [ ] **Step 3: Create web/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create web/src/styles/global.css**

```css
:root {
  --bg: #0A0A0A;
  --surface: #0F0F0F;
  --active: #1F1F1F;
  --border: #2a2a2a;
  --text-primary: #FAFAFA;
  --text-secondary: #6B7280;
  --text-tertiary: #4B5563;
  --accent-green: #10B981;
  --accent-amber: #F59E0B;
  --accent-cyan: #06B6D4;
  --font-ui: "JetBrains Mono", monospace;
  --font-body: "IBM Plex Mono", monospace;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.4;
}

#root { width: 100vw; height: 100vh; display: flex; }
```

- [ ] **Step 5: Create web/src/api/client.ts**

```typescript
const API_BASE = "http://localhost:3001";

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 6: Create web/src/api/ws.ts**

```typescript
const WS_BASE = "ws://localhost:3001";

export function createSessionSocket(sessionId: string, onEvent: (event: any) => void) {
  let ws: WebSocket | null = null;
  let lastEventId = 0;

  function connect() {
    ws = new WebSocket(`${WS_BASE}/ws/sessions/${sessionId}`);
    ws.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.id) lastEventId = event.id;
      onEvent(event);
    };
    ws.onclose = () => {
      setTimeout(connect, 1000); // Reconnect after 1s
    };
  }

  connect();

  return {
    getLastEventId: () => lastEventId,
    close: () => { ws?.close(); },
  };
}
```

- [ ] **Step 7: Create web/src/router.ts and web/src/main.tsx**

`web/src/router.ts`:
```typescript
import { createRouter, createRoute, createRootRoute } from "@tanstack/react-router";
import { LiveSession } from "./pages/LiveSession";
import { SessionList } from "./pages/SessionList";

const rootRoute = createRootRoute();

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/$sessionId",
  component: LiveSession,
});

const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: SessionList,
});

const routeTree = rootRoute.addChildren([listRoute, liveRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router; }
}
```

`web/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router } from "./router";
import "./styles/global.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 8: Create placeholder pages**

`web/src/pages/SessionList.tsx`:
```tsx
export function SessionList() {
  return <div style={{ padding: 40, fontFamily: "var(--font-ui)" }}>
    <span style={{ color: "#10B981" }}>&gt;</span> session_list // coming in task 9
  </div>;
}
```

`web/src/pages/LiveSession.tsx`:
```tsx
export function LiveSession() {
  return <div style={{ padding: 40, fontFamily: "var(--font-ui)" }}>
    <span style={{ color: "#10B981" }}>&gt;</span> live_session // coming in task 8
  </div>;
}
```

- [ ] **Step 9: Verify the SPA starts**

```bash
cd ~/sireskay/github/aos-platform/web
bunx vite
```

Expected: Opens on `http://localhost:5173`, shows placeholder text.

- [ ] **Step 10: Commit**

```bash
cd ~/sireskay/github/aos-platform
git add web/
git commit -m "feat(web): scaffold React SPA with TanStack Router, Terminal Minimal tokens"
```

---

### Task 8: Live Session page — three-zone layout with real-time events

**Files:**
- Create: `web/src/components/Sidebar.tsx`
- Create: `web/src/components/TopBar.tsx`
- Create: `web/src/components/EventStream.tsx`
- Create: `web/src/components/EventCard.tsx`
- Create: `web/src/components/ConstraintPanel.tsx`
- Create: `web/src/components/ConstraintGauge.tsx`
- Create: `web/src/components/AgentDot.tsx`
- Create: `web/src/hooks/useSession.ts`
- Modify: `web/src/pages/LiveSession.tsx`

This is the largest task. It builds all the UI components for the live session view.

- [ ] **Step 1: Create web/src/hooks/useSession.ts**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api/client";
import { createSessionSocket } from "../api/ws";
import type { SessionDetail, TranscriptEvent } from "@aos-platform/shared";

export function useSession(sessionId: string) {
  const [events, setEvents] = useState<TranscriptEvent[]>([]);

  const session = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => apiFetch<SessionDetail>(`/api/sessions/${sessionId}`),
    refetchInterval: 5000,
  });

  const transcript = useQuery({
    queryKey: ["transcript", sessionId],
    queryFn: () => apiFetch<TranscriptEvent[]>(`/api/sessions/${sessionId}/transcript`),
    enabled: !!session.data,
  });

  useEffect(() => {
    if (transcript.data) setEvents(transcript.data);
  }, [transcript.data]);

  useEffect(() => {
    const socket = createSessionSocket(sessionId, (event: TranscriptEvent) => {
      setEvents((prev) => [...prev, event]);
    });
    return () => socket.close();
  }, [sessionId]);

  return { session: session.data, events, isLoading: session.isLoading };
}
```

- [ ] **Step 2: Create AgentDot component**

`web/src/components/AgentDot.tsx`:
```tsx
export function AgentDot({ color }: { color: string }) {
  return <div style={{
    width: 6, height: 6, borderRadius: "50%",
    backgroundColor: color, flexShrink: 0,
  }} />;
}
```

- [ ] **Step 3: Create ConstraintGauge component**

`web/src/components/ConstraintGauge.tsx`:
```tsx
interface GaugeProps {
  label: string;
  current: number;
  min: number;
  max: number;
  unit: string;
  formatValue?: (v: number) => string;
}

export function ConstraintGauge({ label, current, min, max, unit, formatValue }: GaugeProps) {
  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const minMet = current >= min;
  const fmt = formatValue || ((v) => `${v}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text-primary)" }}>{label}</span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)" }}>{fmt(current)} / {fmt(max)}{unit}</span>
      </div>
      <div style={{ height: 6, background: "var(--active)", width: "100%" }}>
        <div style={{ height: 6, background: "var(--accent-green)", width: `${pct}%` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: minMet ? "var(--accent-green)" : "var(--text-secondary)" }}>min: {fmt(min)}{unit} {minMet ? "[ok]" : ""}</span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--text-secondary)" }}>max: {fmt(max)}{unit}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create EventCard component**

`web/src/components/EventCard.tsx`:
```tsx
import type { TranscriptEvent } from "@aos-platform/shared";

const AGENT_COLORS: Record<string, string> = {
  arbiter: "#F59E0B",
  catalyst: "#10B981",
  sentinel: "#FAFAFA",
  architect: "#b392f0",
  provocateur: "#06B6D4",
  navigator: "#6dd5ed",
  advocate: "#f97583",
  pathfinder: "#79c0ff",
  strategist: "#d2a8ff",
};

function agentColor(agentId: string): string {
  return AGENT_COLORS[agentId] || "#6B7280";
}

export function EventCard({ event }: { event: TranscriptEvent }) {
  const p = event.payload;

  if (event.event_type === "delegation") {
    return (
      <div style={{ padding: 16, borderLeft: "3px solid var(--accent-amber)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, color: "var(--accent-amber)" }}>round_{event.round} // {p.target === "all" ? "broadcast" : "targeted_delegation"}</span>
        </div>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-primary)", lineHeight: 1.4 }}>&gt; [{Array.isArray(p.parallel) ? (p.parallel as string[]).join(", ") : p.target}] &quot;{p.message as string}&quot;</p>
      </div>
    );
  }

  if (event.event_type === "response" || event.event_type === "final_statement") {
    const color = agentColor(event.agent_id || "");
    return (
      <div style={{ padding: 16, borderLeft: `3px solid ${color}`, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, color }}>{event.agent_id}</span>
          <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)" }}>${typeof p.cost === "number" ? p.cost.toFixed(2) : "?"} // {p.tokensOut || p.tokens_out || "?"}t</span>
        </div>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-primary)", lineHeight: 1.4 }}>{(p.text as string) || ""}</p>
      </div>
    );
  }

  if (event.event_type === "constraint_check") {
    const state = (p.state || p) as any;
    const status = state.hit_maximum ? "[max_hit]" : state.approaching_any_maximum ? "[approaching]" : "[ok]";
    const statusColor = state.hit_maximum ? "#f97583" : state.approaching_any_maximum ? "var(--accent-amber)" : "var(--accent-green)";
    return (
      <div style={{ padding: "8px 16px", border: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)" }}>constraint_check r{event.round}:</span>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, color: statusColor }}>{status}</span>
      </div>
    );
  }

  // Generic fallback
  return (
    <div style={{ padding: "8px 16px", border: "1px solid var(--border)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)" }}>{event.event_type} {event.agent_id ? `// ${event.agent_id}` : ""}</span>
    </div>
  );
}
```

- [ ] **Step 5: Create EventStream, Sidebar, TopBar, ConstraintPanel components**

`web/src/components/EventStream.tsx`:
```tsx
import { useEffect, useRef } from "react";
import type { TranscriptEvent } from "@aos-platform/shared";
import { EventCard } from "./EventCard";

export function EventStream({ events }: { events: TranscriptEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)" }}>// event_stream</span>
      {events.map((e) => <EventCard key={e.id} event={e} />)}
      <div ref={bottomRef} />
    </div>
  );
}
```

`web/src/components/Sidebar.tsx`:
```tsx
import { Link } from "@tanstack/react-router";
import { AgentDot } from "./AgentDot";

interface AgentInfo { id: string; cost: number; status: "idle" | "responding" | "orchestrator" }

export function Sidebar({ agents, activeNav }: { agents: AgentInfo[]; activeNav: string }) {
  const navItems = [
    { id: "live_sessions", path: "/" },
    { id: "session_history", path: "/" },
    { id: "cost_analytics", path: "/" },
    { id: "profiles", path: "/" },
  ];

  const dotColor = (a: AgentInfo) =>
    a.status === "orchestrator" ? "var(--accent-amber)" :
    a.status === "responding" ? "var(--accent-cyan)" : "var(--accent-green)";

  return (
    <div style={{ width: 240, borderRight: "1px solid var(--border)", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 0, flexShrink: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 20, fontWeight: 700, color: "var(--accent-green)" }}>&gt;</span>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 18, fontWeight: 500, color: "var(--text-primary)" }}>aos.engineer</span>
      </div>

      <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>// navigation</span>
        {navItems.map((n) => (
          <div key={n.id} style={{ padding: "8px 12px", display: "flex", gap: 8, alignItems: "center", background: activeNav === n.id ? "var(--active)" : "transparent" }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: activeNav === n.id ? "var(--accent-green)" : "var(--text-secondary)" }}>$</span>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: activeNav === n.id ? "var(--text-primary)" : "var(--text-secondary)" }}>{n.id}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)" }}>// agents [{agents.length}]</span>
        {agents.map((a) => (
          <div key={a.id} style={{ padding: "8px 12px", display: "flex", gap: 8, alignItems: "center", border: "1px solid var(--border)" }}>
            <AgentDot color={dotColor(a)} />
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: a.status === "orchestrator" ? "var(--accent-amber)" : a.status === "responding" ? "var(--accent-cyan)" : "var(--text-primary)", fontWeight: a.status === "orchestrator" ? 700 : 400 }}>{a.id}</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)", marginLeft: "auto" }}>{a.status === "responding" ? "[responding...]" : `$${a.cost.toFixed(2)}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

`web/src/components/TopBar.tsx`:
```tsx
export function TopBar({ profileId, domainId, round, maxRounds, elapsed, maxMinutes, cost, maxBudget, isLive }: {
  profileId: string; domainId: string | null; round: number; maxRounds: number;
  elapsed: number; maxMinutes: number; cost: number; maxBudget: number | null; isLive: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        {isLive && <div style={{ background: "var(--accent-green)", padding: "4px 12px", display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--bg)" }} />
          <span style={{ fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 500, color: "var(--bg)" }}>live</span>
        </div>}
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 28, fontWeight: 700, color: "var(--text-primary)" }}>$ {profileId}</span>
        {domainId && <span style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: "var(--text-secondary)" }}>/{domainId}</span>}
      </div>
      <div style={{ display: "flex", gap: 24, fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text-secondary)" }}>
        <span>round [{round}/{maxRounds}]</span>
        <span>{elapsed.toFixed(1)}m / {maxMinutes}m</span>
        {maxBudget !== null && <span style={{ color: "var(--accent-green)" }}>${cost.toFixed(2)} / ${maxBudget.toFixed(2)}</span>}
      </div>
    </div>
  );
}
```

`web/src/components/ConstraintPanel.tsx`:
```tsx
import { ConstraintGauge } from "./ConstraintGauge";
import type { SessionConstraints } from "@aos-platform/shared";

export function ConstraintPanel({ constraints, elapsed, cost, rounds, biasRatio, sessionId, authMode }: {
  constraints: SessionConstraints; elapsed: number; cost: number; rounds: number;
  biasRatio: number; sessionId: string; authMode?: string;
}) {
  return (
    <div style={{ width: 240, borderLeft: "1px solid var(--border)", paddingLeft: 24, display: "flex", flexDirection: "column", gap: 16, flexShrink: 0 }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)" }}>// constraints</span>
      <ConstraintGauge label="time" current={elapsed} min={constraints.time.min_minutes} max={constraints.time.max_minutes} unit="m" formatValue={(v) => v.toFixed(1)} />
      {constraints.budget && <ConstraintGauge label="budget" current={cost} min={constraints.budget.min} max={constraints.budget.max} unit="" formatValue={(v) => `$${v.toFixed(2)}`} />}
      <ConstraintGauge label="rounds" current={rounds} min={constraints.rounds.min} max={constraints.rounds.max} unit="" formatValue={(v) => String(Math.floor(v))} />

      <div style={{ height: 1, background: "var(--border)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)" }}>// bias_tracking</span>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text-primary)" }}>ratio</span>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: 20, fontWeight: 700, color: "var(--accent-green)" }}>{biasRatio.toFixed(1)} : 1</span>
        </div>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)" }}>limit: {constraints.bias_limit}.0</span>
      </div>

      <div style={{ height: 1, background: "var(--border)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)" }}>// session</span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)" }}>id: {sessionId.slice(0, 12)}</span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-secondary)" }}>auth: {authMode || "unknown"}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire LiveSession page**

Replace `web/src/pages/LiveSession.tsx`:

```tsx
import { useParams } from "@tanstack/react-router";
import { useSession } from "../hooks/useSession";
import { Sidebar } from "../components/Sidebar";
import { TopBar } from "../components/TopBar";
import { EventStream } from "../components/EventStream";
import { ConstraintPanel } from "../components/ConstraintPanel";

export function LiveSession() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  const { session, events, isLoading } = useSession(sessionId);

  if (isLoading || !session) {
    return <div style={{ padding: 40, fontFamily: "var(--font-ui)", color: "var(--text-secondary)" }}>loading session...</div>;
  }

  const lastConstraint = [...events].reverse().find((e) => e.event_type === "constraint_check");
  const state = (lastConstraint?.payload?.state || {}) as any;

  const agents = session.participants.map((id) => ({
    id,
    cost: session.agent_costs?.[id] || 0,
    status: id === session.participants[0] ? "orchestrator" as const : "idle" as const,
  }));

  const constraints = session.constraints || { time: { min_minutes: 0, max_minutes: 10 }, budget: null, rounds: { min: 0, max: 8 }, bias_limit: 5 };
  const isLive = session.status === "running";

  return (
    <div style={{ display: "flex", width: "100%", height: "100vh" }}>
      <Sidebar agents={agents} activeNav="live_sessions" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 40, gap: 24 }}>
        <TopBar
          profileId={session.profile_id} domainId={session.domain_id}
          round={session.rounds_completed} maxRounds={constraints.rounds.max}
          elapsed={state.elapsed_minutes || 0} maxMinutes={constraints.time.max_minutes}
          cost={Number(session.total_cost)} maxBudget={constraints.budget?.max || null}
          isLive={isLive}
        />
        <div style={{ height: 1, background: "var(--border)" }} />
        <div style={{ display: "flex", flex: 1, gap: 24, overflow: "hidden" }}>
          <EventStream events={events} />
          <ConstraintPanel
            constraints={constraints}
            elapsed={state.elapsed_minutes || 0}
            cost={Number(session.total_cost)}
            rounds={session.rounds_completed}
            biasRatio={state.bias_ratio || 1}
            sessionId={session.id}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify the page renders**

```bash
cd ~/sireskay/github/aos-platform/web
bunx vite
```

Navigate to `http://localhost:5173/sessions/test-ingest-1` (use a session ID from the ingestion test). Expected: Live session layout renders with event stream and constraint panel.

- [ ] **Step 8: Commit**

```bash
cd ~/sireskay/github/aos-platform
git add web/src/
git commit -m "feat(web): implement Live Session page with event stream, constraints, sidebar"
```

---

### Task 9: Session List page

**Files:**
- Create: `web/src/hooks/useSessions.ts`
- Modify: `web/src/pages/SessionList.tsx`

- [ ] **Step 1: Create useSessions hook**

`web/src/hooks/useSessions.ts`:
```tsx
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import type { SessionSummary } from "@aos-platform/shared";

export function useSessions() {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: () => apiFetch<SessionSummary[]>("/api/sessions"),
    refetchInterval: 10000,
  });
}
```

- [ ] **Step 2: Implement SessionList page**

Replace `web/src/pages/SessionList.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { useSessions } from "../hooks/useSessions";
import { Sidebar } from "../components/Sidebar";

export function SessionList() {
  const { data: sessions, isLoading } = useSessions();

  return (
    <div style={{ display: "flex", width: "100%", height: "100vh" }}>
      <Sidebar agents={[]} activeNav="session_history" />
      <div style={{ flex: 1, padding: 40, display: "flex", flexDirection: "column", gap: 24 }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 28, fontWeight: 700, color: "var(--text-primary)" }}>$ session_history</span>
        <div style={{ height: 1, background: "var(--border)" }} />

        {isLoading && <span style={{ fontFamily: "var(--font-body)", color: "var(--text-secondary)" }}>loading...</span>}

        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Header row */}
          <div style={{ display: "flex", padding: "8px 20px", background: "var(--surface)", fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--text-secondary)" }}>
            <span style={{ flex: 2 }}>profile</span>
            <span style={{ flex: 1 }}>domain</span>
            <span style={{ flex: 1 }}>status</span>
            <span style={{ flex: 1 }}>cost</span>
            <span style={{ flex: 1 }}>rounds</span>
            <span style={{ flex: 2 }}>started</span>
          </div>

          {sessions?.map((s) => (
            <Link key={s.id} to="/sessions/$sessionId" params={{ sessionId: s.id }} style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ display: "flex", padding: "12px 20px", borderBottom: "1px solid var(--border)", fontFamily: "var(--font-ui)", fontSize: 13, cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--active)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span style={{ flex: 2, color: "var(--text-primary)" }}>{s.profile_id}</span>
                <span style={{ flex: 1, color: "var(--text-secondary)" }}>{s.domain_id || "—"}</span>
                <span style={{ flex: 1, color: s.status === "running" ? "var(--accent-green)" : "var(--text-secondary)" }}>[{s.status}]</span>
                <span style={{ flex: 1, color: "var(--text-primary)" }}>${Number(s.total_cost).toFixed(2)}</span>
                <span style={{ flex: 1, color: "var(--text-secondary)" }}>{s.rounds_completed}</span>
                <span style={{ flex: 2, color: "var(--text-secondary)" }}>{new Date(s.started_at).toLocaleString()}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify in browser**

Navigate to `http://localhost:5173/`. Expected: Session list renders with any previously ingested sessions.

- [ ] **Step 4: Commit**

```bash
cd ~/sireskay/github/aos-platform
git add web/src/
git commit -m "feat(web): implement Session List page with terminal minimal styling"
```

---

### Task 10: End-to-end integration test

**Files:**
- No new files — validates the full pipeline

- [ ] **Step 1: Start all services**

```bash
cd ~/sireskay/github/aos-platform
docker compose up -d postgres
cd api && bun run src/index.ts &
cd ../web && bunx vite &
```

- [ ] **Step 2: Simulate a live session via curl**

```bash
SESSION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

# Session start
curl -s -X POST "http://127.0.0.1:3001/api/sessions/$SESSION_ID/events" \
  -H "Content-Type: application/json" \
  -d "[{\"type\":\"session_start\",\"timestamp\":\"$(date -u +%FT%TZ)\",\"profile\":\"strategic-council\",\"domain\":\"saas\",\"participants\":[\"arbiter\",\"catalyst\",\"sentinel\",\"architect\",\"provocateur\"],\"constraints\":{\"time\":{\"min_minutes\":2,\"max_minutes\":10},\"budget\":{\"min\":1,\"max\":10,\"currency\":\"USD\"},\"rounds\":{\"min\":2,\"max\":8},\"bias_limit\":5}}]"

# Delegation
curl -s -X POST "http://127.0.0.1:3001/api/sessions/$SESSION_ID/events" \
  -H "Content-Type: application/json" \
  -d "[{\"type\":\"delegation\",\"timestamp\":\"$(date -u +%FT%TZ)\",\"round\":1,\"target\":\"all\",\"message\":\"Should we build or buy the authentication system?\",\"parallel\":[\"catalyst\",\"sentinel\",\"architect\"],\"sequential\":[\"provocateur\"]}]"

# Agent response
curl -s -X POST "http://127.0.0.1:3001/api/sessions/$SESSION_ID/events" \
  -H "Content-Type: application/json" \
  -d "[{\"type\":\"response\",\"timestamp\":\"$(date -u +%FT%TZ)\",\"agentId\":\"catalyst\",\"round\":1,\"text\":\"Build. Speed to market is everything right now. Off-the-shelf auth solutions add integration overhead that slows our v1 launch.\",\"cost\":0.28,\"tokensIn\":800,\"tokensOut\":1200,\"status\":\"success\"}]"

echo "Session ID: $SESSION_ID"
```

- [ ] **Step 3: Verify in browser**

1. Open `http://localhost:5173/` — session should appear in the list.
2. Click the session — Live Session view should show the delegation and catalyst response.

- [ ] **Step 4: Verify WebSocket streaming**

Open the Live Session view in the browser. Then send another event via curl:

```bash
curl -s -X POST "http://127.0.0.1:3001/api/sessions/$SESSION_ID/events" \
  -H "Content-Type: application/json" \
  -d "[{\"type\":\"response\",\"timestamp\":\"$(date -u +%FT%TZ)\",\"agentId\":\"sentinel\",\"round\":1,\"text\":\"Buy. Building auth is a solved problem. Every week we spend on custom auth is a week not spent on our differentiating features.\",\"cost\":0.31,\"tokensIn\":900,\"tokensOut\":1400,\"status\":\"success\"}]"
```

Expected: Sentinel's response appears in the browser in real-time (within ~1s) without page refresh.

- [ ] **Step 5: Commit final state and tag**

```bash
cd ~/sireskay/github/aos-platform
git add -A
git commit -m "feat: Phase 1 complete — live session streaming, session list, full pipeline"
git tag v0.1.0-alpha
```

---

## Summary

| Task | Repo | What It Builds | Dependencies |
|------|------|---------------|-------------|
| 1 | aos-harness | `onTranscriptEvent` hook in engine | None |
| 2 | aos-harness | `--platform-url` CLI flag + event buffer | Task 1 |
| 3 | aos-platform | Repo init, workspaces, shared types, Docker | None |
| 4 | aos-platform | Drizzle schema + migrations | Task 3 |
| 5 | aos-platform | Hono API: ingestion, WebSocket hub | Task 4 |
| 6 | aos-platform | Session REST endpoints | Task 5 |
| 7 | aos-platform | React SPA scaffold + routing | Task 3 |
| 8 | aos-platform | Live Session page (full UI) | Tasks 6, 7 |
| 9 | aos-platform | Session List page | Tasks 6, 7 |
| 10 | aos-platform | End-to-end integration test | All |

**Parallelization:** Tasks 1-2 (framework) and Tasks 3-4 (platform setup) can run in parallel. Tasks 7-9 (frontend) can run in parallel with Tasks 5-6 (API) once Task 4 is done.
