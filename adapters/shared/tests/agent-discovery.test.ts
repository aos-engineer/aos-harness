import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgents, findProjectRoot } from "../src/agent-discovery";

test("discoverAgents finds agents recursively by agent.yaml", () => {
  const root = mkdtempSync(join(tmpdir(), "discover-"));
  mkdirSync(join(root, "alice"), { recursive: true });
  writeFileSync(join(root, "alice", "agent.yaml"), "id: alice\n");
  mkdirSync(join(root, "nested", "bob"), { recursive: true });
  writeFileSync(join(root, "nested", "bob", "agent.yaml"), "id: bob\n");

  const map = discoverAgents(root);
  expect(map.get("alice")).toBe(join(root, "alice"));
  expect(map.get("bob")).toBe(join(root, "nested", "bob"));
});

test("findProjectRoot walks up to find core/ or .aos/", () => {
  const root = mkdtempSync(join(tmpdir(), "proj-"));
  mkdirSync(join(root, "core"));
  const deep = join(root, "a", "b", "c");
  mkdirSync(deep, { recursive: true });
  expect(findProjectRoot(deep)).toBe(root);
});
