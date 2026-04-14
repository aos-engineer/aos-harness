import { describe, test, expect } from "bun:test";
import { buildToolPolicy } from "../../adapters/shared/src/tool-policy";
import { DEFAULT_TOOL_POLICY } from "../../runtime/src/profile-schema";

describe("buildToolPolicy (spec D3)", () => {
  test("no profile, no flags → default policy (execute_code disabled)", () => {
    const p = buildToolPolicy(DEFAULT_TOOL_POLICY, {});
    expect(p.execute_code.enabled).toBe(false);
    // Frozen
    expect(() => { (p as any).execute_code.enabled = true; }).toThrow();
  });

  test("profile allows [python, bash] + flag=python narrows to [python]", () => {
    const profile = { ...DEFAULT_TOOL_POLICY, execute_code: { enabled: true, languages: ["python", "bash"] as const, max_timeout_ms: 30000 } };
    const p = buildToolPolicy(profile as any, { allowCodeExecution: ["python"] });
    expect(p.execute_code.enabled).toBe(true);
    expect(p.execute_code.languages).toEqual(["python"]);
  });

  test("profile denies execute_code + --allow-code-execution=python throws (widens)", () => {
    expect(() => buildToolPolicy(DEFAULT_TOOL_POLICY, { allowCodeExecution: ["python"] }))
      .toThrow(/cannot widen/);
  });

  test("--allow-code-execution=none forces deny even if profile allows", () => {
    const profile = { ...DEFAULT_TOOL_POLICY, execute_code: { enabled: true, languages: ["python"] as const, max_timeout_ms: 30000 } };
    const p = buildToolPolicy(profile as any, { allowCodeExecution: "none" });
    expect(p.execute_code.enabled).toBe(false);
  });

  test("bare --allow-code-execution with profile allow leaves profile unchanged", () => {
    const profile = { ...DEFAULT_TOOL_POLICY, execute_code: { enabled: true, languages: ["python"] as const, max_timeout_ms: 30000 } };
    const p = buildToolPolicy(profile as any, { allowCodeExecution: "all" });
    expect(p.execute_code.languages).toEqual(["python"]);
  });

  test("flag requests a language not in profile's list → throws (partial mismatch)", () => {
    const profile = { ...DEFAULT_TOOL_POLICY, execute_code: { enabled: true, languages: ["python", "bash"] as const, max_timeout_ms: 30000 } };
    expect(() => buildToolPolicy(profile as any, { allowCodeExecution: ["ruby"] }))
      .toThrow(/cannot widen|ruby/i);
  });
});
