# AOS Platform — Observability & Live Session Dashboard

**Date:** 2026-03-27
**Status:** Approved (pending implementation plan)
**Project:** aos-platform (private repo)
**Framework Dependency:** aos-engineer/aos-harness (public repo)

---

## 1. Vision

AOS Platform is a real-time observability and analytics web application for the AOS Harness. It enables engineers to watch multi-agent deliberations unfold live, replay completed sessions, track costs, and evaluate agent behavior — all through a browser-based dashboard.

The platform serves all three tiers of AOS users, delivered in phases:

- **Phase 1 (Developer Tooling):** Framework authors and contributors use the dashboard to debug agent behavior, validate constraint enforcement, and watch deliberations in real-time during development.
- **Phase 2 (Tier 2 Users):** Engineers building custom profiles use the dashboard to understand why deliberations went a certain way, test new agents, and tune constraints.
- **Phase 3 (Tier 3 Enterprise):** Teams running multiple sessions get cost analytics, session history, team management, SSO, and audit trails.

This spec covers the full vision. Implementation is phased — Phase 1 is the immediate build target.

---

## 2. Repo & Separation Strategy

### Open Source vs. Proprietary

The platform lives in a **separate private repository** (`aos-engineer/aos-platform`) to protect monetizable features. The open-source framework (`aos-engineer/aos-harness`) remains clean and community-friendly.

```
aos-engineer/aos-harness (public, MIT/Apache)
├── core/           — agents, profiles, domains, workflows
├── runtime/        — TypeScript engine (~1600 LOC)
├── adapters/       — pi, claude-code, gemini
├── cli/            — aos commands
├── site/           — Astro marketing site
└── docs/           — specs, plans

aos-engineer/aos-platform (private, proprietary)
├── api/            — Hono backend (WebSocket + REST)
├── web/            — React SPA dashboard
├── db/             — Drizzle schema + migrations
├── shared/         — Types shared between api/ and web/
└── docker/         — Deployment configs
```

### Dependency Model

The platform imports `@aos-harness/runtime` as an npm dependency. The framework has no knowledge of or dependency on the platform. Communication flows one way: framework emits events → platform consumes them.

---

## 3. Architecture

### System Overview

```
┌─────────────────────────┐
│   aos-harness          │
│   (open source)          │
│                          │
│   AOS Engine             │
│   └── onTranscriptEvent  │──── Event Hook (HTTP POST) ────┐
│       (optional callback)│                                 │
└─────────────────────────┘                                 │
                                                             ▼
                                              ┌──────────────────────────┐
                                              │   aos-platform API       │
                                              │   (Hono on Bun)          │
                                              │                          │
                                              │   ├── Event Ingestion    │
                                              │   ├── Session Manager    │
                                              │   ├── WebSocket Hub      │
                                              │   └── REST API           │
                                              └──────┬───────┬───────────┘
                                                     │       │
                                              ┌──────┘       └──────┐
                                              ▼                      ▼
                                    ┌──────────────┐      ┌──────────────────┐
                                    │  PostgreSQL   │      │  React SPA       │
                                    │  (Drizzle)    │      │  Dashboard       │
                                    │               │      │                  │
                                    │  sessions     │      │  Live Session    │
                                    │  events       │      │  Session History │
                                    │  cost_records │      │  Cost Analytics  │
                                    └──────────────┘      └──────────────────┘
```

### Data Flow

1. User runs `aos run strategic-council` — engine starts deliberation.
2. Engine calls `onTranscriptEvent(entry)` on every transcript event.
3. Hook POSTs event to Platform API's ingestion endpoint.
4. Platform API persists to PostgreSQL AND broadcasts via WebSocket.
5. Browser dashboard receives events in real-time, renders live session view.
6. After session ends, full transcript is available for replay and analytics.

### Framework-Side Change (aos-harness)

A small addition to the engine's `pushTranscript` method — an optional event hook that fires on every transcript entry:

```typescript
// Added to AOSEngine constructor options
interface EngineOpts {
  // ... existing fields ...
  onTranscriptEvent?: (entry: TranscriptEntry) => void | Promise<void>;
}

// In pushTranscript():
pushTranscript(entry: TranscriptEntry): void {
  this.transcript.push(entry);
  if (this.onTranscriptEvent) {
    // Wrapped in try-catch — callback must never crash the engine
    try {
      const result = this.onTranscriptEvent(entry);
      if (result instanceof Promise) {
        result.catch(() => {}); // Swallow errors — fire-and-forget
      }
    } catch {
      // Silent failure — platform observability must never block deliberation
    }
  }
}
```

The hook is optional. When not configured, the engine behaves exactly as before. When configured (e.g., by the CLI when `--platform-url` is passed), it queues events for delivery to the platform API.

**Event delivery model:** The CLI's hook implementation uses a local async buffer that drains in the background. Events are queued into an in-memory array and flushed as batches (up to 20 events per POST) every 500ms or when the buffer reaches 20 events, whichever comes first. Individual POSTs use a 2-second `AbortSignal` timeout. If a POST fails, the batch is dropped silently (Phase 1). Phase 2 adds retry with exponential backoff.

```typescript
// CLI hook implementation (conceptual)
const buffer: TranscriptEntry[] = [];
const FLUSH_INTERVAL = 500;
const BATCH_SIZE = 20;
const TIMEOUT_MS = 2000;

function enqueueEvent(entry: TranscriptEntry) {
  buffer.push(entry);
  if (buffer.length >= BATCH_SIZE) flush();
}

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

setInterval(flush, FLUSH_INTERVAL);
```

---

## 4. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Backend API** | Hono on Bun | TypeScript-native, Bun-compatible, excellent WebSocket support, lightweight |
| **Database** | PostgreSQL + Drizzle ORM | Type-safe end-to-end, battle-tested for analytics queries, Drizzle is lightweight |
| **Frontend** | React SPA + TanStack Router + TanStack Query | No SSR needed (dashboard behind auth), TanStack Query handles WebSocket subscriptions, clean separation from Hono API |
| **Toolchain** | Vite+ | Unified build/dev/lint/test/format, Rust-powered performance, framework-agnostic |
| **Real-time** | WebSocket (Hono native) | Hono's built-in WebSocket support on Bun, TanStack Query subscriptions on the client |
| **Shared Types** | TypeScript package | `shared/` package with types used by both `api/` and `web/` |

### Why This Stack

- **Single language:** TypeScript across the entire project. No Python/Go backend — shares types directly with `@aos-harness/runtime`.
- **Bun-native:** Hono and Vite+ both run on Bun. Matches the harness's runtime.
- **No SSR:** Dashboards don't need SEO or server-side rendering. A React SPA with TanStack Query is the simplest architecture for real-time data.
- **Vite+ toolchain:** Replaces separate Vite + Vitest + ESLint + Prettier configs with a single unified CLI (`vp`).

---

## 5. Database Schema

### `sessions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid, PK | Unique session identifier |
| `profile_id` | text | e.g. "strategic-council", "cto-execution" |
| `domain_id` | text, nullable | e.g. "saas", "fintech" |
| `session_type` | enum | "deliberation" \| "execution" |
| `status` | enum | "running" \| "completed" \| "failed" \| "aborted" |
| `participants` | text[] | Agent IDs in this session |
| `brief_content` | text | Full brief markdown |
| `constraints` | jsonb | Time/budget/rounds config snapshot |
| `total_cost` | decimal | Running total, updated per event |
| `rounds_completed` | integer | Running count |
| `started_at` | timestamp | Session start time |
| `ended_at` | timestamp, nullable | Null while running |

### `transcript_events`

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigserial, PK | Auto-incrementing for ordering |
| `session_id` | uuid, FK → sessions | Which session this belongs to |
| `event_type` | text | delegation, response, constraint_check, error, etc. |
| `agent_id` | text, nullable | Which agent (null for system events) |
| `round` | integer, nullable | Deliberation round number |
| `payload` | jsonb | Full event data (text, cost, state, etc.) |
| `created_at` | timestamp | Event timestamp from engine |

### `cost_records`

Denormalized table for fast analytics. One row per agent per round — extracted from transcript_events on ingestion.

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigserial, PK | Auto-incrementing |
| `session_id` | uuid, FK → sessions | Which session |
| `agent_id` | text | Which agent |
| `round` | integer | Which round |
| `tokens_in` | integer | Input tokens |
| `tokens_out` | integer | Output tokens |
| `cost` | decimal | Cost for this agent in this round |
| `model_tier` | text | economy \| standard \| premium |
| `created_at` | timestamp | When the cost was recorded |

### Indexes

```sql
CREATE INDEX idx_transcript_events_session_time ON transcript_events(session_id, created_at);
CREATE INDEX idx_cost_records_session_agent ON cost_records(session_id, agent_id);
CREATE INDEX idx_sessions_profile_status ON sessions(profile_id, status);
CREATE INDEX idx_sessions_started_at ON sessions(started_at DESC);
```

### Constraint Schema

The `sessions.constraints` JSONB column uses a defined shape (also exported from `shared/`):

```typescript
interface SessionConstraints {
  time: { min_minutes: number; max_minutes: number };
  budget: { min: number; max: number; currency: string } | null; // null = unmetered (subscription)
  rounds: { min: number; max: number };
  bias_limit: number;
}
```

### Event Type Strategy

Event types are stored as `text` in PostgreSQL (not a Postgres enum). Validation happens at the application level via a TypeScript union type in `shared/`:

```typescript
type TranscriptEventType =
  | "session_start" | "agent_spawn" | "delegation" | "response"
  | "constraint_check" | "constraint_warning" | "error"
  | "budget_estimate" | "end_session" | "final_statement"
  | "session_end" | "agent_destroy" | "expertise_write"
  | "gate_result" | "review_submission" | "workflow_step";
```

This avoids Postgres enum migrations when new event types are added to the harness.

### Model Tier Mapping

The `cost_records.model_tier` column maps from framework tiers to actual model names. The mapping lives in `shared/`:

```typescript
const MODEL_TIER_MAP: Record<string, string[]> = {
  economy: ["claude-haiku-4-5", "gemini-2.0-flash", "gpt-4o-mini"],
  standard: ["claude-sonnet-4-6", "gemini-2.5-pro", "gpt-4o"],
  premium: ["claude-opus-4-6", "o3", "gemini-2.5-pro-thinking"],
};
```

---

## 6. API Design

### Event Ingestion (from engine)

```
POST /api/sessions/:id/events       — Receive transcript event batch from engine hook (array of events)
```

### Sessions (REST)

```
GET  /api/sessions                  — List sessions (filterable by profile, status, date)
GET  /api/sessions/:id              — Session detail + summary stats + per-agent cost summary
GET  /api/sessions/:id/transcript   — Full transcript events (supports ?after_id=N for catch-up)
GET  /api/sessions/:id/costs        — Cost breakdown by agent/round
```

### Analytics

```
GET  /api/analytics/costs           — Cost trends, aggregated by day/week/month
GET  /api/analytics/profiles        — Usage stats per profile
```

### WebSocket (real-time)

```
WS   /ws/sessions/:id              — Stream events for a specific live session
WS   /ws/feed                      — Stream all events across all active sessions
```

**Reconnection strategy:** When a WebSocket connection drops, the client reconnects and fetches missed events via `GET /api/sessions/:id/transcript?after_id=N` (where N is the `id` of the last event it received). Once caught up, it resumes the WebSocket stream. The transcript endpoint supports the `after_id` query parameter for this exact use case. TanStack Query handles the refetch-then-subscribe pattern natively.

### CORS

The React SPA (Vite+ dev server, typically `localhost:5173`) and the Hono API (`localhost:3001`) run on different ports. The Hono API must include CORS middleware allowing the SPA origin:

```typescript
import { cors } from "hono/cors";
app.use("*", cors({ origin: "http://localhost:5173" }));
```

In production, the SPA is served as static files by the API itself (or a reverse proxy), so CORS is only needed for local development.

### Event Ingestion Flow

When `POST /api/sessions/:id/events` receives a batch of transcript events:

1. **Parse and validate** each event. Event types are validated at the application level using a TypeScript union type in `shared/` (not a Postgres enum — new event types are likely as the harness evolves, and ALTER TYPE migrations are painful).
2. **Upsert session** — if batch contains a `session_start` event, create session record. Otherwise, update running totals (cost, rounds).
3. **Bulk insert events** into `transcript_events`.
4. **Extract costs** — for any `response` events with cost data, insert into `cost_records`.
5. **Broadcast** — push each event to all WebSocket subscribers for this session AND the global feed.

### Transcript Import (Phase 2)

```
POST /api/sessions/:id/import       — Bulk import a transcript.jsonl file
```

Import is deferred to Phase 2. The single-event batch endpoint handles all Phase 1 ingestion. When import ships, it reuses the same ingestion pipeline but reads from the JSONL file format rather than live events.

---

## 7. Frontend — Live Session Dashboard

### Design System

Terminal Minimal (`webapp-02-terminalminimal_light`) — pure dark-mode, dual monospace typography (JetBrains Mono + IBM Plex Mono), terminal syntax as visual language, emerald green (#10B981) accent, zero border radius.

Design mockup created in Pencil (see `.pen` file in project root).

### Layout: Three-Zone Architecture

```
┌──────────┬────────────────────────────────────┬───────────┐
│          │  Top Bar                            │           │
│          │  [live] $ profile_name /domain      │  stats    │
│ Sidebar  ├────────────────────────────────────┤           │
│          │                                    │Constraint │
│ // nav   │  Event Stream                      │  Panel    │
│          │                                    │           │
│ // agents│  delegation → responses → check    │ gauges    │
│          │  delegation → responses → check    │ bias      │
│          │  ...scrolling...                   │ session   │
│          │                                    │           │
└──────────┴────────────────────────────────────┴───────────┘
```

### Sidebar (240px fixed)

- **Logo:** `> aos.engineer` (green prompt + white text)
- **Navigation:** `// navigation` section header, `$ live_sessions` (active, highlighted), `$ session_history`, `$ cost_analytics`, `$ profiles`
- **Agent Roster:** `// agents [N]` section header. Each agent shows:
  - Color-coded status dot (amber=orchestrator, green=idle, cyan=responding)
  - Agent name in monospace
  - Cost or status (`$0.82` or `[responding...]`)

### Top Bar

- **Live badge:** Green background, black text, pulsing dot
- **Session title:** `$ strategic-council /saas` (profile + domain)
- **Stats:** `round [3/8]`, `4.2m / 10m`, `$3.40 / $10.00`

### Event Stream (center, scrolling)

Each event type has a distinct visual treatment:

- **Delegation:** Amber left border, `round_N // targeted_delegation` header, `> [agents] "message"` body
- **Agent Response:** Agent-colored left border, agent name + `$cost // Nk tokens` header, response text body
- **Typing Indicator:** Cyan left border, dark fill background, `[speaks_last]` tag, italic "generating response..."
- **Constraint Check:** Bordered inline card, `constraint_check rN: [ok]` with details

### Constraint Panel (240px fixed, right)

- **Gauges:** Time, budget, rounds — each with label, current/max values, progress bar (green fill on dark track), min/max annotations
- **Bias Tracking:** `// bias_tracking` header, ratio display (`1.5 : 1`), limit value
- **Session Info:** `// session` header with id, auth mode, start time

### Pages (Phase 1)

1. **Live Session** — the primary view described above
2. **Session List** — table of past sessions with profile, domain, status, cost, duration

### Pages (Phase 2+)

3. **Session Replay** — same layout as Live Session but with timeline scrubber and playback controls
4. **Cost Analytics** — charts showing cost trends, per-profile breakdowns, per-agent cost distributions
5. **Profile Browser** — view available profiles with agent rosters and constraint configurations
6. **Settings** — platform configuration, API keys, team management (Phase 3)

---

## 8. Framework Integration

### CLI Integration

New `--platform-url` flag on `aos run`:

```bash
aos run strategic-council --platform-url http://localhost:3001
```

When provided, the CLI configures the engine's `onTranscriptEvent` hook to POST events to the platform API. The platform URL can also be set in `.aos/config.yaml`:

```yaml
platform:
  url: http://localhost:3001
  enabled: true
```

### Transcript Import

For sessions run without the platform connected, the existing transcript JSONL files can be bulk-imported:

```bash
# Via CLI (future command)
aos platform import .aos/sessions/session-abc123/transcript.jsonl

# Via API
curl -X POST http://localhost:3001/api/sessions/abc123/import \
  -H "Content-Type: application/jsonl" \
  --data-binary @transcript.jsonl
```

---

## 9. Phasing

### Phase 1 — Live Session + Session List (Immediate)

**Framework changes (aos-harness):**
- Add `onTranscriptEvent` optional hook to `AOSEngine`
- Add `--platform-url` flag to `aos run` CLI command
- Wire the hook to HTTP POST when platform URL is configured

**Platform (aos-platform):**
- Hono API: event ingestion, session CRUD, WebSocket streaming
- PostgreSQL schema: sessions, transcript_events, cost_records
- React SPA: Live Session view, Session List view
- Docker Compose for local development (API + PostgreSQL)
- Vite+ toolchain setup

**Success criteria:** An engineer runs `aos run strategic-council --platform-url http://localhost:3001`, opens the dashboard in a browser, and watches the deliberation unfold in real-time with agent responses appearing as they arrive, constraint gauges updating, and agent status dots reflecting who is currently responding.

### Phase 2 — Replay + Analytics

- Session Replay with timeline scrubber and playback speed controls
- Cost Analytics dashboard (charts, trends, per-profile breakdowns)
- Profile Browser
- Transcript import (CLI command + API endpoint)

### Phase 3 — Enterprise

- Team management (invite users, assign roles)
- SSO (OAuth2 / OIDC)
- Audit trails
- Multi-tenant isolation
- SaaS deployment model

---

## 10. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Separate repo | Private `aos-platform` | Monetizable features stay proprietary; framework stays open-source |
| Streaming model | Event hook (HTTP POST) | Direct, low-latency (~10-50ms), works across machines, enables future SaaS. Framework isn't public yet, so no backward compatibility concern. |
| Backend | Hono on Bun | Single language (TypeScript), Bun-native, shares types with runtime, lightweight |
| Frontend | React SPA (no SSR) | Dashboards don't need SEO. TanStack Query handles real-time data perfectly. Simplest architecture. |
| Toolchain | Vite+ | Unified build/dev/lint/test, Rust-powered performance, framework-agnostic |
| Database | PostgreSQL + Drizzle | Type-safe, battle-tested for analytics, Drizzle is lightweight ORM |
| Design system | Terminal Minimal | Matches the CLI-native identity of AOS. Developer-focused audience. Monospace typography, terminal syntax, emerald green accent. |
| Cost tracking | Denormalized table | `cost_records` extracted on ingestion for fast analytics without scanning all transcript events |

---

## 11. Open Questions (Deferred to Implementation)

1. **Authentication for Phase 1:** No auth for Phase 1 (localhost only). The default Docker Compose config binds the API to `127.0.0.1` only — this prevents accidental exposure on non-localhost interfaces (common with Docker port mappings or cloud dev environments). The WebSocket global feed (`/ws/feed`) streams all events across all sessions, which would be sensitive if exposed. Auth is added in Phase 2.
2. **Event delivery guarantees:** Resolved — the CLI hook uses a local async buffer with batched POSTs and 2-second timeouts. Failed batches are dropped silently in Phase 1. Phase 2 adds retry with exponential backoff.
3. **Session archival:** How long are sessions stored? Is there a retention policy? Recommendation: defer to Phase 3 (enterprise).
4. **WebSocket authentication:** How do WebSocket connections authenticate? Recommendation: token-based auth header, implemented in Phase 2.
5. **Vite+ compatibility:** Vite+ is in alpha. Validate that it works with Hono's Bun server and Drizzle's code generation before committing. Fallback: standard Vite + Vitest is a low-cost backup.
