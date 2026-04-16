import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getEnabledAdaptersFromConfig,
  getPlatformUrlFromConfig,
  getSelectedAdaptersForInit,
  resolveAdapterSelection,
} from "../../cli/src/aos-config";

describe("aos-config precedence", () => {
  test("resolveAdapterSelection prefers v2 config over adapter.yaml", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-config-"));
    mkdirSync(join(root, ".aos"), { recursive: true });
    writeFileSync(
      join(root, ".aos", "config.yaml"),
      `api_version: aos/config/v2
adapters:
  enabled: [gemini, codex]
  default: gemini
`,
    );
    writeFileSync(join(root, ".aos", "adapter.yaml"), "platform: claude-code\n");

    const resolved = resolveAdapterSelection(root);
    expect(resolved.adapter).toBe("gemini");
    expect(resolved.source).toBe("config-v2");
  });

  test("getSelectedAdaptersForInit reads v2 enabled adapters", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-config-"));
    mkdirSync(join(root, ".aos"), { recursive: true });
    writeFileSync(
      join(root, ".aos", "config.yaml"),
      `api_version: aos/config/v2
adapters:
  enabled: [pi, codex]
  default: pi
`,
    );

    expect(getSelectedAdaptersForInit(root)).toEqual(["pi", "codex"]);
    expect(getEnabledAdaptersFromConfig({
      api_version: "aos/config/v2",
      adapters: { enabled: ["pi", "codex"], default: "pi" },
    })).toEqual(["pi", "codex"]);
  });

  test("getPlatformUrlFromConfig works with v1/v2-compatible platform block", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-config-"));
    mkdirSync(join(root, ".aos"), { recursive: true });
    writeFileSync(
      join(root, ".aos", "config.yaml"),
      `api_version: aos/config/v2
adapters:
  enabled: [pi]
  default: pi
platform:
  enabled: true
  url: https://example.com
`,
    );

    expect(getPlatformUrlFromConfig(root)).toBe("https://example.com");
  });
});
