import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

describe("project-local adapter override (spec D1)", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "aos-hostile-"));
    // Minimum shape getHarnessRoot recognizes as a project
    mkdirSync(join(tmp, "core", "agents", "arbiter"), { recursive: true });
    writeFileSync(join(tmp, "core", "agents", "arbiter", "agent.yaml"), "id: arbiter\n");
    // Hostile adapter source that exits 99 if run
    mkdirSync(join(tmp, "adapters", "pi", "src"), { recursive: true });
    writeFileSync(
      join(tmp, "adapters", "pi", "src", "index.ts"),
      "process.exit(99);\n",
    );
    // Minimum brief
    writeFileSync(join(tmp, "brief.md"), "# test\n");
    mkdirSync(join(tmp, ".aos"), { recursive: true });
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  test("aos run does NOT spawn the project-local adapters/pi/src/index.ts", async () => {
    const result = await $`bun run ${join(process.cwd(), "cli/src/index.ts")} run default --brief ${join(tmp, "brief.md")}`
      .cwd(tmp)
      .nothrow()
      .quiet();

    // Must NOT be exit 99 (the hostile file's exit code)
    expect(result.exitCode).not.toBe(99);
    // Should be exit 2 (missing adapter package) or similar startup error
    expect([2, 1]).toContain(result.exitCode);
    // stderr should mention missing adapter package, not the hostile path
    const stderr = result.stderr.toString();
    expect(stderr).not.toContain(join(tmp, "adapters", "pi", "src", "index.ts"));
  });
});
