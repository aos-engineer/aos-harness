# Phase 3 — Distribution & Reach

## Goal

Make the AOS Framework installable, discoverable, and demo-ready. Validate the adapter contract across a third platform (Gemini CLI). Seed the community contribution model.

## Architecture

Four independent deliverables, each shippable on its own:

1. **Gemini CLI Adapter** — Code generator following the Claude Code adapter pattern
2. **Monorepo Packaging** — Bun workspaces, proper exports, global CLI install
3. **AOS.engineer Static Site** — Astro content site reading directly from `core/` YAML
4. **Community Registry** — JSON-based registry with PR submission flow

## Constraints

- No spec update (user will handle separately)
- No full web platform (deferred to Phase 5)
- Static site only — no backend, no auth, no database
- Core directory structure unchanged — packaging wraps existing layout

---

## Deliverable 1: Gemini CLI Adapter

### Purpose

Validate that the adapter contract generalizes to a third platform. Same code-generator pattern as Claude Code adapter — reads core config, produces Gemini CLI-compatible artifacts.

### File Structure

```
adapters/gemini/
├── src/
│   ├── generate.ts       # CLI entry: --profile, --domain, --output
│   └── templates.ts      # Gemini-specific formatting
├── package.json          # @aos-framework/gemini-adapter
├── tsconfig.json
└── README.md
```

### Output Artifacts

Gemini CLI uses `GEMINI.md` for system instructions and agents as markdown files in `.gemini/agents/`.

Generated files:
- `.gemini/agents/aos-<id>.md` — One file per agent (YAML frontmatter + system prompt)
- `.gemini/settings.json` — Model tier mappings
- `GEMINI-aos.md` — Fragment to append to project `GEMINI.md` (roster, delegation syntax)

### Model Tier Mapping

| AOS Tier | Gemini Model |
|----------|-------------|
| economy | gemini-2.0-flash |
| standard | gemini-2.5-pro |
| premium | gemini-2.5-pro (thinking mode) |

### Generation Flow

```
generate.ts
  ↓ parseArgs(--profile, --domain, --output)
  ↓ findProjectRoot() → discover core/ directory
  ↓ loadProfile() + loadAgents() + optional loadDomain()
  ↓ applyDomain() (if domain provided)
  ↓ Generate via templates.ts:
    ├── generateAgentFile(agent, profile, allAgentNames)
    ├── generateSettingsFile(profile)
    └── generateGeminiMdFragment(profile, agents)
  ↓ writeFileSync to outputDir
```

### Agent File Format (.gemini/agents/aos-<id>.md)

```markdown
---
name: AOS Catalyst
description: Momentum and commercial velocity perspective agent
model: gemini-2.5-pro
---

# Catalyst — Revenue & Momentum Lens

You are **Catalyst**, a perspective agent in a structured multi-agent deliberation.

## Identity
{resolved system prompt from core/agents/perspectives/catalyst/prompt.md}

## Cognitive Framework
- **Objective:** Maximize momentum and commercial velocity
- **Core Bias:** speed-and-monetization
- **Risk Tolerance:** high
- **Time Horizon:** 30-90 days

## Heuristics
{agent heuristics from agent.yaml}

## Constraints
{profile constraints summary}
```

### GEMINI-aos.md Fragment

```markdown
# AOS Framework — Strategic Council

## Available Agents
| Agent | Role | Bias |
|-------|------|------|
| aos-arbiter | Orchestrator & Synthesizer | neutral-synthesis |
| aos-catalyst | Revenue & Momentum | speed-and-monetization |
...

## How to Use
1. Start a deliberation: "Run the strategic council on [topic]"
2. The Arbiter orchestrates — delegates to agents, synthesizes
3. Agents respond from their cognitive frameworks
4. Arbiter produces a structured memo

## Delegation Syntax
- Broadcast: @aos-arbiter "Ask all agents about X"
- Targeted: @aos-catalyst @aos-sentinel "Debate X"
- Tension pair: @aos-catalyst @aos-sentinel "Resolve the speed vs. safety tension on X"
```

### Tests

- Unit test: `generate.ts` produces expected files for strategic-council profile
- Unit test: domain overlay applied correctly to generated prompts
- Integration: generated files are valid markdown with correct YAML frontmatter

### Dependencies

- `@aos-framework/runtime` (for config-loader, domain-merger, template-resolver)
- `js-yaml`

---

## Deliverable 2: Monorepo Packaging

### Purpose

Make the framework installable via `bunx @aos-framework/cli init`. Enable clean dependency management across packages.

### Root package.json

```json
{
  "name": "aos-framework",
  "private": true,
  "workspaces": [
    "runtime",
    "cli",
    "adapters/*"
  ],
  "scripts": {
    "test": "bun test --cwd runtime",
    "test:integration": "bun run tests/integration/validate-config.ts",
    "validate": "bun run cli/src/index.ts validate",
    "typecheck": "bun x tsc --noEmit --project runtime/tsconfig.json",
    "publish:all": "bun run scripts/publish.ts"
  }
}
```

### Package Updates

#### runtime/package.json
```json
{
  "name": "@aos-framework/runtime",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/engine.ts",
    "./config-loader": "./src/config-loader.ts",
    "./types": "./src/types.ts",
    "./constraint-engine": "./src/constraint-engine.ts",
    "./delegation-router": "./src/delegation-router.ts",
    "./domain-merger": "./src/domain-merger.ts",
    "./template-resolver": "./src/template-resolver.ts",
    "./workflow-runner": "./src/workflow-runner.ts"
  },
  "files": ["src/", "package.json", "tsconfig.json"]
}
```

#### cli/package.json
```json
{
  "name": "@aos-framework/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "aos": "./src/index.ts"
  },
  "files": ["src/", "../core/"],
  "dependencies": {
    "@aos-framework/runtime": "workspace:*",
    "js-yaml": "^4.1.0"
  }
}
```

#### Each adapter gets proper exports

```json
{
  "name": "@aos-framework/pi-adapter",
  "exports": { ".": "./src/index.ts" },
  "files": ["src/"],
  "dependencies": {
    "@aos-framework/runtime": "workspace:*"
  }
}
```

### Publish Script

`scripts/publish.ts` — Bun script that:
1. Validates all tests pass
2. Validates all integration checks pass
3. Bumps version across all packages (synchronized)
4. Runs `bun publish` for each public package
5. Tags the release in git

### .npmrc

```
@aos-framework:registry=https://registry.npmjs.org/
```

### What Ships as Packages

| Package | Public | Purpose |
|---------|--------|---------|
| `@aos-framework/runtime` | Yes | Core engine, types, loaders |
| `@aos-framework/cli` | Yes | CLI + bundled core config |
| `@aos-framework/pi-adapter` | Yes | Pi extension |
| `@aos-framework/claude-code-adapter` | Yes | Claude Code generator |
| `@aos-framework/gemini-adapter` | Yes | Gemini CLI generator |

The `core/` directory is NOT a separate package — it ships bundled with the CLI.

---

## Deliverable 3: AOS.engineer Static Site

### Purpose

Public-facing site for the AOS Framework. Landing page, agent/profile/domain galleries, documentation. Reads directly from `core/` YAML files — one source of truth.

### Stack

- **Astro** — Content-first static site generator, zero JS by default
- **Content Collections** — Schema-validated reads of agent/profile/domain YAML
- **React Islands** — Interactive components via `client:visible` directive
- **Tailwind CSS** — Utility-first styling
- **MDX** — Docs pages with interactive examples
- **Deploy target:** Vercel or Cloudflare Pages (static export)

### File Structure

```
site/
├── astro.config.mjs
├── tailwind.config.mjs
├── package.json
├── tsconfig.json
├── public/
│   ├── favicon.svg
│   └── og-image.png           # Social preview
├── src/
│   ├── content/
│   │   ├── config.ts           # Content collection schemas
│   │   ├── agents/             # Symlinked from core/agents/ (flattened)
│   │   ├── profiles/           # Symlinked from core/profiles/
│   │   └── docs/               # MDX documentation pages
│   │       ├── getting-started.mdx
│   │       ├── creating-agents.mdx
│   │       ├── creating-profiles.mdx
│   │       └── creating-domains.mdx
│   ├── layouts/
│   │   ├── Base.astro          # HTML shell, meta tags, global styles
│   │   └── Docs.astro          # Sidebar nav + content area
│   ├── pages/
│   │   ├── index.astro         # Landing page
│   │   ├── agents/
│   │   │   ├── index.astro     # Agent gallery (12 cards)
│   │   │   └── [id].astro      # Agent detail page
│   │   ├── profiles/
│   │   │   ├── index.astro     # Profile gallery (5 profiles)
│   │   │   └── [id].astro      # Profile detail
│   │   ├── domains/
│   │   │   └── index.astro     # Domain gallery (5 domains)
│   │   └── docs/
│   │       └── [...slug].astro # Catch-all docs from content collection
│   ├── components/
│   │   ├── AgentCard.tsx        # Agent summary card (React island)
│   │   ├── ProfileViewer.tsx    # Interactive assembly visualization
│   │   ├── TensionPairMap.tsx   # SVG tension pair diagram
│   │   ├── Hero.astro           # Landing page hero section
│   │   ├── CodeBlock.astro      # Syntax-highlighted code
│   │   └── Nav.astro            # Site navigation
│   └── styles/
│       └── global.css           # Tailwind imports + custom styles
```

### Content Collection Config

```typescript
// src/content/config.ts
import { defineCollection, z } from 'astro:content';

const agents = defineCollection({
  type: 'data',
  schema: z.object({
    schema: z.string(),
    id: z.string(),
    name: z.string(),
    role: z.string(),
    cognition: z.object({
      objective_function: z.string(),
      core_bias: z.string(),
      risk_tolerance: z.string(),
      default_stance: z.string(),
      time_horizon: z.object({
        primary: z.string(),
        secondary: z.string(),
        peripheral: z.string(),
      }),
    }),
    persona: z.object({
      temperament: z.array(z.string()),
      thinking_patterns: z.array(z.string()),
      heuristics: z.array(z.object({ name: z.string(), rule: z.string() })),
      evidence_standard: z.object({
        convincing: z.array(z.string()),
        unconvincing: z.array(z.string()),
      }),
      red_lines: z.array(z.string()),
    }),
    tensions: z.array(z.object({ agent: z.string(), dynamic: z.string() })),
  }),
});

const profiles = defineCollection({
  type: 'data',
  schema: z.object({
    schema: z.string(),
    id: z.string(),
    name: z.string(),
    description: z.string(),
    assembly: z.object({
      orchestrator: z.string(),
      perspectives: z.array(z.object({
        agent: z.string(),
        required: z.boolean(),
      })),
    }),
    constraints: z.object({
      time: z.object({ min_minutes: z.number(), max_minutes: z.number() }),
      budget: z.object({ min: z.number(), max: z.number() }).nullable(),
      rounds: z.object({ min: z.number(), max: z.number() }),
    }),
    delegation: z.object({
      tension_pairs: z.array(z.tuple([z.string(), z.string()])),
      bias_limit: z.number(),
      opening_rounds: z.number(),
    }),
  }),
});

const docs = defineCollection({
  type: 'content',  // MDX/Markdown
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number(),
    tier: z.enum(['1', '2', '3']).optional(),
  }),
});

export const collections = { agents, profiles, docs };
```

### Content Sourcing Strategy

Agent YAML files live in nested directories (`core/agents/perspectives/catalyst/agent.yaml`). Astro content collections expect a flat directory. Solution: **build script** that creates symlinks:

```bash
# scripts/link-content.sh
#!/bin/bash
SITE_CONTENT="site/src/content"
CORE="core"

# Flatten agents into site/src/content/agents/
mkdir -p "$SITE_CONTENT/agents"
for agent_dir in "$CORE"/agents/*/; do
  for sub_dir in "$agent_dir"*/; do
    if [ -f "$sub_dir/agent.yaml" ]; then
      name=$(basename "$sub_dir")
      ln -sf "$(pwd)/$sub_dir/agent.yaml" "$SITE_CONTENT/agents/$name.yaml"
    fi
  done
done

# Flatten profiles
mkdir -p "$SITE_CONTENT/profiles"
for profile_dir in "$CORE"/profiles/*/; do
  name=$(basename "$profile_dir")
  ln -sf "$(pwd)/$profile_dir/profile.yaml" "$SITE_CONTENT/profiles/$name.yaml"
done
```

This runs as a prebuild step: `"prebuild": "bash scripts/link-content.sh"`

### Key Pages

#### Landing Page (`index.astro`)
- Hero: "Train AI agents to think like your best advisors"
- Value prop: 3-column grid (12 Agents, 5 Profiles, 5 Domains)
- Quick start code snippet: `bunx @aos-framework/cli init && aos run strategic-council`
- Demo video placeholder (16:9 aspect ratio container)
- CTA: "Get Started" → /docs/getting-started

#### Agent Gallery (`agents/index.astro`)
- Grid of 12 agent cards
- Each card shows: name, role, core_bias, risk_tolerance, 3 key heuristics
- Color-coded by category (orchestrator = gold, perspective = blue, operational = green)
- Filter by category (React island with `client:visible`)

#### Agent Detail (`agents/[id].astro`)
- Full cognitive framework display
- Objective function, time horizons, bias, risk tolerance
- All heuristics with rules
- Evidence standards (convincing vs unconvincing)
- Red lines
- Tension pairs this agent participates in
- Prompt excerpt (first 10 lines of prompt.md)

#### Profile Gallery (`profiles/index.astro`)
- Cards showing: name, description, agent count, constraint ranges
- Visual: agent assembly as small avatar row
- Tension pair count badge

#### Profile Detail (`profiles/[id].astro`)
- Full assembly: orchestrator + perspectives (required/optional)
- Constraints table (time, budget, rounds)
- Tension pair diagram (TensionPairMap React component)
- Delegation rules (bias limit, opening rounds)

#### Domain Gallery (`domains/index.astro`)
- Cards with domain name, lexicon preview (key metrics)
- Agent overlay count
- Compatible profiles

#### Docs (`docs/[...slug].astro`)
- Left sidebar navigation (ordered by `order` frontmatter)
- Tier badges on tutorials (Tier 1/2/3)
- Content from MDX files with interactive code blocks

### Interactive Components (React Islands)

#### AgentCard.tsx
- Hover: expands to show heuristics
- Click: navigates to detail page
- Badge: core_bias and risk_tolerance

#### ProfileViewer.tsx
- SVG visualization of agent assembly
- Orchestrator in center, perspectives in ring
- Lines connecting tension pairs
- Hover agent to highlight its tensions

#### TensionPairMap.tsx
- Force-directed graph of tension relationships
- Nodes = agents, edges = tension pairs
- Color-coded by agent category
- Hover shows tension dynamic description

### Design Tokens

```css
/* Color palette — professional, technical, approachable */
--color-bg: #0a0a0f;
--color-surface: #14141f;
--color-border: #2a2a3a;
--color-text: #e4e4ef;
--color-text-muted: #8888a0;
--color-accent: #6366f1;      /* Indigo — primary */
--color-accent-hover: #818cf8;
--color-success: #22c55e;
--color-warning: #f59e0b;

/* Agent category colors */
--color-orchestrator: #f59e0b; /* Gold */
--color-perspective: #6366f1;  /* Indigo */
--color-operational: #22c55e;  /* Green */
```

Dark mode only for launch. Light mode is a follow-up.

---

## Deliverable 4: Community Registry

### Purpose

Seed the community contribution model. A JSON registry of community agents, profiles, and domains with a PR-based submission flow.

### File Structure

```
registry/
├── registry.json          # The registry data
├── registry.schema.json   # JSON Schema for validation
├── CONTRIBUTING.md        # Submission guide
└── validate.ts            # Bun script to validate entries
```

### Registry Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "aos/registry/v1",
  "type": "object",
  "required": ["version", "agents", "profiles", "domains"],
  "properties": {
    "version": { "const": "1" },
    "agents": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "author", "description", "source", "version"],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$",
            "description": "namespace/agent-name format"
          },
          "name": { "type": "string" },
          "author": { "type": "string" },
          "description": { "type": "string", "maxLength": 200 },
          "tags": { "type": "array", "items": { "type": "string" } },
          "source": { "type": "string", "format": "uri" },
          "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
          "compatible_profiles": {
            "type": "array",
            "items": { "type": "string" }
          },
          "schema_version": { "const": "aos/agent/v1" }
        }
      }
    },
    "profiles": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "author", "description", "source", "version"],
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$" },
          "name": { "type": "string" },
          "author": { "type": "string" },
          "description": { "type": "string", "maxLength": 200 },
          "agent_count": { "type": "integer" },
          "tags": { "type": "array", "items": { "type": "string" } },
          "source": { "type": "string", "format": "uri" },
          "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" }
        }
      }
    },
    "domains": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "author", "description", "source", "version"],
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$" },
          "name": { "type": "string" },
          "author": { "type": "string" },
          "description": { "type": "string", "maxLength": 200 },
          "tags": { "type": "array", "items": { "type": "string" } },
          "source": { "type": "string", "format": "uri" },
          "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" }
        }
      }
    }
  }
}
```

### Registry Data (Initial — Built-in Framework Assets)

```json
{
  "version": "1",
  "agents": [
    {
      "id": "aos/arbiter",
      "name": "Arbiter",
      "author": "aos-framework",
      "description": "Neutral orchestrator that synthesizes competing perspectives into ranked recommendations",
      "tags": ["orchestrator", "synthesis", "facilitation"],
      "source": "https://github.com/aos-framework/aos-framework",
      "version": "0.1.0",
      "compatible_profiles": ["strategic-council", "security-review", "delivery-ops", "architecture-review", "incident-response"],
      "schema_version": "aos/agent/v1"
    }
  ],
  "profiles": [],
  "domains": []
}
```

The initial registry lists all 12 built-in agents, 5 profiles, and 5 domains. Community contributions appear alongside.

### Validation Script

`registry/validate.ts` — Bun script that:
1. Loads `registry.json`
2. Validates against `registry.schema.json`
3. Checks all IDs are unique
4. Checks namespace format (`author/name`)
5. Validates source URLs are reachable (optional, skippable with `--offline`)

### CONTRIBUTING.md

Documents:
1. How to create an AOS agent/profile/domain
2. How to add it to the registry (fork, edit registry.json, PR)
3. Review criteria (schema-compliant, tested, documented)
4. Namespace rules (`your-github-handle/agent-name`)

---

## Testing Strategy

### Gemini Adapter Tests
- Unit: `generate.ts` produces correct file structure
- Unit: templates resolve all variables
- Unit: domain overlay applied to generated prompts
- Integration: generated files are valid markdown with YAML frontmatter

### Packaging Tests
- Workspace resolution: `bun install` at root resolves all workspace dependencies
- CLI binary: `bunx @aos-framework/cli --help` prints usage
- Exports: each package's exports resolve correctly

### Site Tests
- Build: `cd site && bun run build` succeeds
- Content: all agent YAML files validate against collection schema
- Pages: all routes generate valid HTML
- Links: no broken internal links

### Registry Tests
- Schema: `registry.json` validates against `registry.schema.json`
- Uniqueness: no duplicate IDs
- Format: all IDs match namespace pattern

---

## Success Criteria

1. `bunx @aos-framework/cli init --adapter gemini` generates valid Gemini CLI config
2. `bun install` at monorepo root resolves all workspace dependencies
3. `cd site && bun run build` produces static site with all galleries populated
4. `bun run registry/validate.ts` passes with 0 errors
5. All 78 existing runtime tests still pass
6. All 22 integration checks still pass
