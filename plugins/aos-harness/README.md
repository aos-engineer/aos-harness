# AOS Harness Host Installs

This bundle keeps adapters as the runtime boundary and adds thin host-native install surfaces on top.

## Surfaces

- `Codex`: local plugin via [`.codex-plugin/plugin.json`](./.codex-plugin/plugin.json) and [`.agents/plugins/marketplace.json`](../../.agents/plugins/marketplace.json)
- `Claude Code`: project slash-command pack in [`claude-code/commands/`](./claude-code/commands/)
- `Pi`: extension package via [`adapters/pi/package.json`](../../adapters/pi/package.json)

## Shared Wrapper

All host surfaces call:

```bash
plugins/aos-harness/scripts/aos_cli.sh
```

The wrapper resolves the repo root from `AOS_HARNESS_ROOT` first, then from the repo-local checkout. If you install the host plugin outside this repository, set `AOS_HARNESS_ROOT` to the repo root before invoking it.
