import { test, expect } from "bun:test";
import { connect } from "node:net";
import { startBridgeServer } from "../cli/src/bridge-server";

function isSocketPermissionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
}

async function tryStartBridgeServer(): Promise<{ host: string; port: number; close: () => Promise<void> } | null> {
  const host = "127.0.0.1";
  const port = 43000 + Math.floor(Math.random() * 1000);
  try {
    const close = await startBridgeServer(`tcp://${host}:${port}`, {
      delegate: async (params) => ({ responses: [{ from: params.to, text: "ok" }] }),
      end: async () => ({ ok: true }),
    });
    return { host, port, close };
  } catch (error) {
    if (isSocketPermissionError(error)) {
      return null;
    }
    throw error;
  }
}

function rpc(host: string, port: number, req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        sock.end();
        resolve(JSON.parse(buf.slice(0, nl)));
      }
    });
    sock.on("error", reject);
    sock.write(JSON.stringify(req) + "\n");
  });
}

test("bridge server dispatches delegate", async () => {
  const bridge = await tryStartBridgeServer();
  if (!bridge) return;

  const resp = await rpc(bridge.host, bridge.port, {
    id: "1", method: "delegate", params: { to: "alice", message: "hi" },
  });
  expect(resp.id).toBe("1");
  expect(resp.result.responses[0].text).toBe("ok");
  await bridge.close();
});

test("close() returns promptly even with a connected client", async () => {
  const bridge = await tryStartBridgeServer();
  if (!bridge) return;

  const client = connect({ host: bridge.host, port: bridge.port });
  await new Promise((resolve) => client.on("connect", resolve));
  const start = Date.now();
  await bridge.close();
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(500);
  client.destroy();
});

test("bridge server returns error for unknown method", async () => {
  const bridge = await tryStartBridgeServer();
  if (!bridge) return;

  const resp = await rpc(bridge.host, bridge.port, { id: "2", method: "bogus", params: {} });
  expect(resp.error).toMatch(/unknown method/i);
  await bridge.close();
});
