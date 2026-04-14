import { describe, test, expect } from "bun:test";
import { ADAPTER_ALLOWLIST, isValidAdapter } from "../../cli/src/utils";

describe("ADAPTER_ALLOWLIST (spec D2)", () => {
  test("exports the four allowed adapters", () => {
    expect(ADAPTER_ALLOWLIST).toEqual(["pi", "claude-code", "codex", "gemini"]);
  });

  test("isValidAdapter accepts only allowlisted names", () => {
    expect(isValidAdapter("pi")).toBe(true);
    expect(isValidAdapter("claude-code")).toBe(true);
    expect(isValidAdapter("codex")).toBe(true);
    expect(isValidAdapter("gemini")).toBe(true);
  });

  test("isValidAdapter rejects traversal and unknown values", () => {
    expect(isValidAdapter("../evil")).toBe(false);
    expect(isValidAdapter("banana")).toBe(false);
    expect(isValidAdapter("")).toBe(false);
    expect(isValidAdapter("pi/foo")).toBe(false);
    expect(isValidAdapter("PI")).toBe(false); // case-sensitive
  });
});
