# @aos-harness/adapter-shared

Shared base classes and utilities used by every AOS Harness platform adapter (Claude Code, Codex, Gemini, Pi).

Re-exports common types (`AgentRuntime`, `EventBus`, etc.) and provides composition helpers (`composeAdapter`, `BaseEventBus`, `BaseWorkflow`) so each adapter only needs to implement platform-specific runtime logic.

Part of the [AOS Harness](https://aos.engineer) monorepo. Most users install `aos-harness` (the CLI) instead of consuming this package directly.

## Requirements

- Bun ≥ 1.0.0

## License

MIT
