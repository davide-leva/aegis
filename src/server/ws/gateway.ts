import type { Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

import { verifyToken } from "../lib/jwt.js";

export type WsMessage =
  | { type: "invalidate"; keys: string[] }
  | { type: "acme-progress"; operationId: string; step: string; status: "running" | "done" | "error"; detail?: string };

export class WsGateway {
  private wss: WebSocketServer | null = null;

  attach(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "", "ws://localhost");
      const token = url.searchParams.get("token");
      try {
        if (!token) throw new Error("missing token");
        verifyToken(token);
      } catch {
        ws.close(4001, "Unauthorized");
        return;
      }
      ws.on("error", () => ws.close());
    });
  }

  broadcast(keys: string[]) {
    if (!this.wss || this.wss.clients.size === 0) return;
    const data = JSON.stringify({ type: "invalidate", keys } satisfies WsMessage);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  broadcastAcmeProgress(operationId: string, step: string, status: "running" | "done" | "error", detail?: string) {
    if (!this.wss || this.wss.clients.size === 0) return;
    const data = JSON.stringify({ type: "acme-progress", operationId, step, status, detail } satisfies WsMessage);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}
