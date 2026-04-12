import { test, expect } from "bun:test";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridgeServer } from "../cli/src/bridge-server";

function rpc(socketPath: string, req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath);
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
  const sockPath = join(tmpdir(), `aos-test-${Date.now()}-${Math.random()}.sock`);
  const close = await startBridgeServer(sockPath, {
    delegate: async (params) => ({ responses: [{ from: params.to, text: "ok" }] }),
    end: async () => ({ ok: true }),
  });
  const resp = await rpc(sockPath, {
    id: "1", method: "delegate", params: { to: "alice", message: "hi" },
  });
  expect(resp.id).toBe("1");
  expect(resp.result.responses[0].text).toBe("ok");
  await close();
});

test("bridge server returns error for unknown method", async () => {
  const sockPath = join(tmpdir(), `aos-test-${Date.now()}-${Math.random()}.sock`);
  const close = await startBridgeServer(sockPath, {
    delegate: async () => ({}),
    end: async () => ({}),
  });
  const resp = await rpc(sockPath, { id: "2", method: "bogus", params: {} });
  expect(resp.error).toMatch(/unknown method/i);
  await close();
});
