// ── Pi Workflow Layer (L4) ────────────────────────────────────────
// Parallel dispatch, file operations, and state persistence.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import * as yaml from "js-yaml";
import type {
  WorkflowAdapter,
  AgentHandle,
  AgentResponse,
  ArtifactManifest,
  LoadedArtifact,
  ExecuteCodeOpts,
  ExecutionResult,
  SkillInput,
  SkillResult,
  ReviewResult,
} from "@aos-framework/runtime/types";
import { UnsupportedError } from "@aos-framework/runtime/types";

// ── PiWorkflow ───────────────────────────────────────────────────

export class PiWorkflow implements WorkflowAdapter {
  private agentRuntime: any; // PiAgentRuntime reference for sendMessage
  private projectRoot: string;

  constructor(agentRuntime: any, projectRoot: string = process.cwd()) {
    this.agentRuntime = agentRuntime;
    this.projectRoot = resolve(projectRoot);
  }

  private validatePath(filePath: string): string {
    const resolved = resolve(filePath);
    if (!resolved.startsWith(this.projectRoot)) {
      throw new Error(`Path "${filePath}" is outside the project directory`);
    }
    return resolved;
  }

  private validateStateKey(key: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      throw new Error(`Invalid state key: "${key}" — must be alphanumeric with hyphens/underscores`);
    }
  }

  // ── dispatchParallel ────────────────────────────────────────────
  // Sends a message to all handles concurrently via Promise.allSettled.
  // Fulfilled results carry status "success"; rejected results carry status "failed".

  async dispatchParallel(
    handles: AgentHandle[],
    message: string,
    opts?: { signal?: AbortSignal; onStream?: (agentId: string, partial: string) => void },
  ): Promise<AgentResponse[]> {
    const tasks = handles.map((handle) =>
      this.agentRuntime.sendMessage(handle, message, {
        signal: opts?.signal,
        onStream: opts?.onStream ? (partial: string) => opts.onStream!(handle.agentId, partial) : undefined,
      }),
    );

    const results = await Promise.allSettled(tasks);

    return results.map((result, i): AgentResponse => {
      if (result.status === "fulfilled") {
        return result.value as AgentResponse;
      }
      // Rejected — surface the error as a failed AgentResponse
      const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return {
        text: "",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        contextTokens: 0,
        model: "",
        status: "failed",
        error: err,
      };
    });
  }

  // ── isolateWorkspace ────────────────────────────────────────────
  // Creates a temporary git worktree and returns path + cleanup function.

  async isolateWorkspace(): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const id = `aos-worktree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const worktreePath = join(".aos", "worktrees", id);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("git", ["worktree", "add", "--detach", worktreePath], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`git worktree add failed (exit ${code}): ${stderr.trim()}`));
        }
      });
    });

    const cleanup = async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("git", ["worktree", "remove", "--force", worktreePath], {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        proc.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`git worktree remove failed (exit ${code}): ${stderr.trim()}`));
          }
        });
      });
    };

    return { path: worktreePath, cleanup };
  }

  // ── writeFile ───────────────────────────────────────────────────

  async writeFile(path: string, content: string): Promise<void> {
    const safe = this.validatePath(path);
    const dir = dirname(safe);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(safe, content, "utf-8");
  }

  // ── readFile ────────────────────────────────────────────────────

  async readFile(path: string): Promise<string> {
    const safe = this.validatePath(path);
    if (!existsSync(safe)) {
      throw new Error(`File not found: ${path}`);
    }
    return readFileSync(safe, "utf-8");
  }

  // ── openInEditor ────────────────────────────────────────────────

  private static ALLOWED_EDITORS = new Set(["code", "vim", "nvim", "nano", "emacs", "subl", "mate", "open"]);

  async openInEditor(path: string, editor: string): Promise<void> {
    const safePath = this.validatePath(path);
    const editorName = editor.split("/").pop() ?? editor;
    if (!PiWorkflow.ALLOWED_EDITORS.has(editorName)) {
      throw new Error(`Editor "${editor}" is not in the allowed list: ${[...PiWorkflow.ALLOWED_EDITORS].join(", ")}`);
    }
    spawn(editor, [safePath], { detached: true, stdio: "ignore" }).unref();
  }

  // ── persistState ────────────────────────────────────────────────
  // Writes value to .aos/state/<key>.json as JSON.

  async persistState(key: string, value: unknown): Promise<void> {
    this.validateStateKey(key);
    const stateDir = join(".aos", "state");
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    const filePath = this.validatePath(join(stateDir, `${key}.json`));
    writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
  }

  // ── loadState ───────────────────────────────────────────────────
  // Reads from .aos/state/<key>.json; returns null if the file is missing.

  async loadState(key: string): Promise<unknown> {
    this.validateStateKey(key);
    const filePath = this.validatePath(join(".aos", "state", `${key}.json`));
    if (!existsSync(filePath)) {
      return null;
    }
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  }

  // ── createArtifact ─────────────────────────────────────────────
  // Writes artifact content and a sidecar manifest YAML file.

  async createArtifact(artifact: ArtifactManifest, content: string): Promise<void> {
    await this.writeFile(artifact.content_path, content);
    const manifestPath = artifact.content_path.replace(/\.[^.]+$/, '.artifact.yaml');
    await this.writeFile(manifestPath, yaml.dump(artifact));
  }

  // ── loadArtifact ──────────────────────────────────────────────
  // Reads an artifact manifest and its content from a session directory.

  async loadArtifact(artifactId: string, sessionDir: string): Promise<LoadedArtifact> {
    const manifestPath = join(sessionDir, 'artifacts', `${artifactId}.artifact.yaml`);
    const manifestYaml = await this.readFile(manifestPath);
    const manifest = yaml.load(manifestYaml, { schema: yaml.JSON_SCHEMA }) as ArtifactManifest;
    const content = await this.readFile(manifest.content_path);
    return { manifest, content };
  }

  // ── submitForReview ───────────────────────────────────────────

  async submitForReview(artifact: LoadedArtifact, reviewer: AgentHandle, reviewPrompt?: string): Promise<ReviewResult> {
    throw new UnsupportedError("submitForReview", "Pi adapter does not yet support automated review submission.");
  }

  // ── executeCode ───────────────────────────────────────────────

  async executeCode(handle: AgentHandle, code: string, opts?: ExecuteCodeOpts): Promise<ExecutionResult> {
    const language = opts?.language ?? "bash";
    const timeout = opts?.timeout_ms ?? 30000;
    const cwd = opts?.cwd ?? process.cwd();
    const sandbox = opts?.sandbox ?? "strict";

    // Determine the command based on language
    let cmd: string;
    let args: string[];

    switch (language) {
      case "bash":
      case "sh":
        cmd = "/bin/bash";
        args = ["-c", code];
        break;
      case "typescript":
      case "ts":
        cmd = "bun";
        args = ["eval", code];
        break;
      case "python":
      case "py":
        cmd = "python3";
        args = ["-c", code];
        break;
      case "node":
      case "javascript":
      case "js":
        cmd = "node";
        args = ["-e", code];
        break;
      default:
        throw new Error(`Unsupported language: ${language}. Supported: bash, typescript, python, javascript`);
    }

    return new Promise<ExecutionResult>((resolve) => {
      const startTime = Date.now();
      let stdout = "";
      let stderr = "";
      let killed = false;

      const child = spawn(cmd, args, {
        cwd: this.validatePath(cwd),
        env: {
          ...this.buildSafeEnv(sandbox),
          ...(opts?.env ?? {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Timeout enforcement
      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, timeout);

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
        // Truncate at 1MB to prevent memory exhaustion
        if (stdout.length > 1_048_576) {
          stdout = stdout.slice(0, 1_048_576) + "\n[TRUNCATED]";
          killed = true;
          child.kill("SIGKILL");
        }
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > 1_048_576) {
          stderr = stderr.slice(0, 1_048_576) + "\n[TRUNCATED]";
        }
      });

      child.on("close", (exitCode: number | null) => {
        clearTimeout(timer);
        resolve({
          success: exitCode === 0 && !killed,
          exit_code: exitCode ?? (killed ? 137 : 1),
          stdout,
          stderr: killed && !stderr.includes("TRUNCATED") ? stderr + "\n[KILLED: timeout or output limit]" : stderr,
          duration_ms: Date.now() - startTime,
        });
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          exit_code: 1,
          stdout,
          stderr: err.message,
          duration_ms: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Build a safe environment for code execution.
   * Strict mode: minimal env, no network-related vars.
   * Relaxed mode: inherits more from parent process.
   */
  private buildSafeEnv(sandbox: "strict" | "relaxed"): Record<string, string> {
    const base: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      TERM: "dumb",
    };

    if (sandbox === "relaxed") {
      // Include more env vars for tools that need them
      for (const key of ["NODE_PATH", "BUN_INSTALL", "PYTHONPATH", "SHELL"]) {
        if (process.env[key]) base[key] = process.env[key]!;
      }
    }

    return base;
  }

  // ── invokeSkill ───────────────────────────────────────────────

  async invokeSkill(handle: AgentHandle, skillId: string, input: SkillInput): Promise<SkillResult> {
    throw new UnsupportedError("invokeSkill", "Pi adapter does not yet support skill invocation.");
  }
}
