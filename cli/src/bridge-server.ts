import { createServer, Socket } from "node:net";
import { unlinkSync, existsSync } from "node:fs";

export interface BridgeHandlers {
  delegate: (params: { to: string | string[]; message: string }) => Promise<unknown>;
  end: (params: { closing_message: string }) => Promise<unknown>;
}

function parseListenTarget(target: string): { host: string; port: number } | { path: string } {
  if (!target.startsWith("tcp://")) {
    return { path: target };
  }

  const url = new URL(target);
  const port = Number.parseInt(url.port, 10);
  if (!url.hostname || Number.isNaN(port)) {
    throw new Error(`Invalid bridge listen target: ${target}`);
  }

  return { host: url.hostname, port };
}

export async function startBridgeServer(
  socketPath: string,
  handlers: BridgeHandlers,
): Promise<() => Promise<void>> {
  const listenTarget = parseListenTarget(socketPath);
  const isUnixSocket = "path" in listenTarget;

  if (isUnixSocket && existsSync(listenTarget.path)) unlinkSync(listenTarget.path);

  const open = new Set<Socket>();

  const server = createServer((sock: Socket) => {
    open.add(sock);
    sock.on("close", () => open.delete(sock));
    let buf = "";
    sock.on("data", async (chunk) => {
      buf += chunk.toString("utf-8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let req: any;
        try { req = JSON.parse(line); } catch { continue; }
        try {
          let result: unknown;
          if (req.method === "delegate") result = await handlers.delegate(req.params);
          else if (req.method === "end") result = await handlers.end(req.params);
          else throw new Error(`unknown method: ${req.method}`);
          sock.write(JSON.stringify({ id: req.id, result }) + "\n");
        } catch (err: any) {
          sock.write(JSON.stringify({ id: req.id, error: String(err?.message ?? err) }) + "\n");
        }
      }
    });
    sock.on("error", () => { /* client disconnect is fine */ });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    if ("path" in listenTarget) {
      server.listen(listenTarget.path, () => resolve());
      return;
    }
    server.listen(listenTarget.port, listenTarget.host, () => resolve());
  });

  return async () => {
    for (const s of open) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (isUnixSocket && existsSync(listenTarget.path)) unlinkSync(listenTarget.path);
  };
}
