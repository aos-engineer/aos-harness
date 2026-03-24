// ── Pi Workflow Layer (L4) ────────────────────────────────────────
// Parallel dispatch, file operations, and state persistence.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { WorkflowAdapter, AgentHandle, AgentResponse } from "@aos-framework/runtime/types";

// ── PiWorkflow ───────────────────────────────────────────────────

export class PiWorkflow implements WorkflowAdapter {
  private agentRuntime: any; // PiAgentRuntime reference for sendMessage

  constructor(agentRuntime: any) {
    this.agentRuntime = agentRuntime;
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
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, content, "utf-8");
  }

  // ── readFile ────────────────────────────────────────────────────

  async readFile(path: string): Promise<string> {
    if (!existsSync(path)) {
      throw new Error(`File not found: ${path}`);
    }
    return readFileSync(path, "utf-8");
  }

  // ── openInEditor ────────────────────────────────────────────────

  async openInEditor(path: string, editor: string): Promise<void> {
    spawn(editor, [path], { detached: true, stdio: "ignore" }).unref();
  }

  // ── persistState ────────────────────────────────────────────────
  // Writes value to .aos/state/<key>.json as JSON.

  async persistState(key: string, value: unknown): Promise<void> {
    const stateDir = join(".aos", "state");
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    const filePath = join(stateDir, `${key}.json`);
    writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
  }

  // ── loadState ───────────────────────────────────────────────────
  // Reads from .aos/state/<key>.json; returns null if the file is missing.

  async loadState(key: string): Promise<unknown> {
    const filePath = join(".aos", "state", `${key}.json`);
    if (!existsSync(filePath)) {
      return null;
    }
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  }
}
