import { describe, expect, test } from "bun:test";
import { runWizard } from "../../cli/src/init-wizard";
import type { PromptContext } from "../../cli/src/prompts";
import type { ScanReport } from "../../cli/src/init-types";

const scan: ScanReport = {
  packageManager: "bun",
  adapters: {
    pi: {
      adapter: "pi",
      vendorCli: { present: true, path: "/usr/bin/pi", auth: { state: "ready" } },
      aosAdapter: { installed: true, loadable: true, store: "bun", resolvedFrom: "/pkg/pi" },
      status: "ready",
      statusHint: "Pi CLI and AOS adapter are ready.",
    },
    "claude-code": {
      adapter: "claude-code",
      vendorCli: { present: true, path: "/usr/bin/claude", auth: { state: "needs-login", hint: "Run `claude login`" } },
      aosAdapter: { installed: false, loadable: false, store: "unknown" },
      status: "needs-login",
      statusHint: "Run `claude login`",
    },
    codex: {
      adapter: "codex",
      vendorCli: { present: true, path: "/usr/bin/codex", auth: { state: "ready" } },
      aosAdapter: { installed: false, loadable: false, store: "unknown" },
      status: "needs-adapter",
      statusHint: "Install @aos-harness/codex-adapter to let AOS use the Codex CLI.",
    },
    gemini: {
      adapter: "gemini",
      vendorCli: { present: false, auth: { state: "unknown", hint: "Install Gemini CLI" } },
      aosAdapter: { installed: false, loadable: false, store: "unknown" },
      status: "needs-cli",
      statusHint: "Install the Gemini CLI first.",
    },
  },
  memory: {
    mempalace: {
      available: false,
      socketPath: "/tmp/mempalace.sock",
    },
  },
  notes: [],
};

function mockPromptContext(): PromptContext {
  return {
    intro() {},
    outro() {},
    note() {},
    cancel() {},
    isCancel: () => false,
    async confirm() {
      return true;
    },
    async select(opts) {
      return opts.initialValue ?? opts.options[0]!.value;
    },
    async multiselect(opts) {
      return opts.initialValues ?? [opts.options[0]!.value];
    },
  };
}

describe("init-wizard", () => {
  test("builds actions from readiness matrix", async () => {
    const result = await runWizard(scan, process.cwd(), undefined, mockPromptContext());
    expect(result.enabledAdapters).toEqual(["pi", "claude-code", "codex"]);
    expect(result.defaultAdapter).toBe("pi");
    expect(result.memory.provider).toBe("expertise");
    expect(result.actions.some((action) => action.type === "install-adapter" && action.packageName === "@aos-harness/codex-adapter")).toBe(true);
    expect(result.actions.some((action) => action.type === "info-login" && action.adapter === "claude-code")).toBe(true);
  });
});
