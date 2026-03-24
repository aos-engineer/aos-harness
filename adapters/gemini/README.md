# AOS Gemini CLI Adapter

Code generator that reads AOS core config (YAML agents, profiles, domains) and produces Gemini CLI-compatible artifacts.

## Usage

```bash
bun install
bun run generate -- --profile strategic-council [--domain saas] [--output .gemini-aos]
```

### Arguments

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--profile` | Yes | — | Profile to generate from (e.g., `strategic-council`) |
| `--domain` | No | — | Optional domain overlay (e.g., `fintech`, `saas`) |
| `--output` | No | `.gemini-aos` | Output directory |

## Output Structure

```
<output>/
  .gemini/
    agents/
      aos-arbiter.md        # Agent files with YAML frontmatter
      aos-catalyst.md
      ...
    settings.json           # Model tier mappings
  GEMINI-aos.md             # Fragment to append to project GEMINI.md
```

## Model Tier Mapping

| AOS Tier | Gemini Model |
|----------|-------------|
| economy | gemini-2.0-flash |
| standard | gemini-2.5-pro |
| premium | gemini-2.5-pro |
