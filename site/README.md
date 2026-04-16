# AOS Docs Site

This directory contains the public Astro site for AOS Harness, including the landing page and the docs pages published at `aos.engineer`.

## Local Development

Run commands from this directory:

```bash
bun install
bun dev
```

The dev server starts on `http://localhost:4321`.

## Key Commands

| Command | Action |
|---|---|
| `bun dev` | Start the local Astro dev server |
| `bun build` | Build the production site into `dist/` |
| `bun preview` | Preview the built site locally |
| `bun astro check` | Run Astro's project checks |

## Content Areas

| Path | Purpose |
|---|---|
| `src/pages/index.astro` | Marketing homepage |
| `src/pages/docs/` | Public documentation pages |
| `src/layouts/` | Shared page layouts |
| `public/` | Static assets |

## Documentation Expectations

- Keep the install flow aligned with the current CLI behavior: vendor CLI first, matching `@aos-harness/*-adapter` second, then `aos init`.
- Prefer commands that match the real shipped interface.
- When changing product behavior, update the matching docs page and any homepage snippets in the same change.
