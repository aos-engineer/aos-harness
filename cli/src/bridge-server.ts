import { createServer, Socket } from "node:net";
import { unlinkSync, existsSync } from "node:fs";

export interface BridgeHandlers {
  delegate: (params: { to: string | string[]; message: string }) => Promise<unknown>;
  end: (params: { closing_message: string }) => Promise<unknown>;
}

export async function startBridgeServer(
  socketPath: string,
  handlers: BridgeHandlers,
): Promise<() => Promise<void>> {
  if (existsSync(socketPath)) unlinkSync(socketPath);

  const server = createServer((sock: Socket) => {
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
    server.listen(socketPath, () => resolve());
  });

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (existsSync(socketPath)) unlinkSync(socketPath);
  };
}
