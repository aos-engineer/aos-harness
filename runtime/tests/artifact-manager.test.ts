import { describe, it, expect, beforeEach } from "bun:test";
import { ArtifactManager } from "../src/artifact-manager";
import { MockAdapter } from "./mock-adapter";
import type { ArtifactManifest } from "../src/types";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

describe("ArtifactManager", () => {
  let sessionDir: string;
  let adapter: MockAdapter;
  let manager: ArtifactManager;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "aos-test-"));
    adapter = new MockAdapter();
    manager = new ArtifactManager(adapter, sessionDir);
  });

  it("creates an artifact with manifest and content", async () => {
    await manager.createArtifact("requirements_analysis", "# Requirements\n\nUser stories here.", {
      produced_by: ["advocate", "strategist"],
      step_id: "understand",
      format: "markdown",
    });

    const loaded = await manager.loadArtifact("requirements_analysis");
    expect(loaded.manifest.id).toBe("requirements_analysis");
    expect(loaded.manifest.produced_by).toEqual(["advocate", "strategist"]);
    expect(loaded.manifest.metadata.review_status).toBe("pending");
    expect(loaded.manifest.metadata.revision).toBe(1);
    expect(loaded.content).toContain("User stories here.");
  });

  it("formats artifact for injection into agent context", async () => {
    await manager.createArtifact("architecture", "# Architecture\n\nMicroservices.", {
      produced_by: ["architect"],
      step_id: "design",
      format: "markdown",
    });

    const injectionBlock = await manager.formatForInjection("architecture");
    expect(injectionBlock).toContain("## Artifact: architecture");
    expect(injectionBlock).toContain("Produced by: architect");
    expect(injectionBlock).toContain("Microservices.");
  });

  it("updates review status", async () => {
    await manager.createArtifact("test_artifact", "content", {
      produced_by: ["agent"],
      step_id: "step",
      format: "markdown",
    });

    await manager.updateReviewStatus("test_artifact", "approved", "step");

    const loaded = await manager.loadArtifact("test_artifact");
    expect(loaded.manifest.metadata.review_status).toBe("approved");
    expect(loaded.manifest.metadata.review_gate).toBe("step");
  });

  it("increments revision on revise", async () => {
    await manager.createArtifact("test_artifact", "v1", {
      produced_by: ["agent"],
      step_id: "step",
      format: "markdown",
    });

    await manager.reviseArtifact("test_artifact", "v2");

    const loaded = await manager.loadArtifact("test_artifact");
    expect(loaded.content).toBe("v2");
    expect(loaded.manifest.metadata.revision).toBe(2);
    expect(loaded.manifest.metadata.review_status).toBe("pending");
  });

  it("throws on loading nonexistent artifact", async () => {
    expect(manager.loadArtifact("nonexistent")).rejects.toThrow();
  });

  it("uses adapter.writeFile for all writes", async () => {
    await manager.createArtifact("test", "content", {
      produced_by: ["agent"],
      step_id: "step",
      format: "markdown",
    });

    const writeCalls = adapter.calls.filter(c => c.method === "writeFile");
    expect(writeCalls.length).toBe(2); // content file + manifest file
  });

  // Security tests
  it("rejects artifact IDs with path traversal characters", async () => {
    await expect(
      manager.createArtifact("../../etc/malicious", "content", {
        produced_by: ["agent"],
        step_id: "step",
        format: "markdown",
      }),
    ).rejects.toThrow("Invalid artifact ID");
  });

  it("rejects artifact IDs with slashes", async () => {
    await expect(
      manager.createArtifact("path/to/file", "content", {
        produced_by: ["agent"],
        step_id: "step",
        format: "markdown",
      }),
    ).rejects.toThrow("Invalid artifact ID");
  });

  it("rejects artifact IDs starting with uppercase", async () => {
    await expect(
      manager.createArtifact("UpperCase", "content", {
        produced_by: ["agent"],
        step_id: "step",
        format: "markdown",
      }),
    ).rejects.toThrow("Invalid artifact ID");
  });

  it("accepts valid artifact IDs with underscores and hyphens", async () => {
    await manager.createArtifact("requirements_analysis", "content", {
      produced_by: ["agent"],
      step_id: "step",
      format: "markdown",
    });
    await manager.createArtifact("task-breakdown", "content", {
      produced_by: ["agent"],
      step_id: "step",
      format: "markdown",
    });
    // Should not throw
    expect(true).toBe(true);
  });

  it("uses adapter.readFile for loads", async () => {
    await manager.createArtifact("test", "content", {
      produced_by: ["agent"],
      step_id: "step",
      format: "markdown",
    });

    // Clear call log, then load
    adapter.calls.length = 0;
    // Clear the manifest cache to force a file read
    manager["manifests"].clear();

    await manager.loadArtifact("test");

    const readCalls = adapter.calls.filter(c => c.method === "readFile");
    expect(readCalls.length).toBe(2); // manifest + content
  });
});
