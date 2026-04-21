# @aos-harness/claude-code-adapter

AOS Harness adapter for Anthropic's Claude Code runtime.

## What It Does

This is a runtime adapter, not a static generator. It lets `aos run` execute both:

- deliberation profiles through the arbiter bridge
- execution profiles through the workflow runner

It also emits transcript events to the local JSONL transcript and, when configured, to the live platform event endpoint.

## Install

```bash
npm i -g @aos-harness/claude-code-adapter
```

Pin the adapter to the same version as the `aos-harness` CLI.

## Host Surface

Claude Code does not currently use the Codex-style plugin marketplace flow here. The host-native install surface in this repo is the reusable command pack under [plugins/aos-harness/claude-code](../../plugins/aos-harness/claude-code/), which installs project slash commands on top of this adapter/runtime layer.
