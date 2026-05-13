import http from "node:http";
import https from "node:https";
import net from "node:net";

import type { Repositories } from "../repositories/index.js";
import type { ProxyRoute } from "../types.js";
import type { WsGateway } from "../ws/gateway.js";

const INTERVAL_MS = 30_000;
const TIMEOUT_MS = 5_000;

export class ProxyHealthChecker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repositories: Repositories,
    private readonly gateway: WsGateway
  ) {}

  start() {
    this.runChecks().catch(console.error);
    this.timer = setInterval(() => { this.runChecks().catch(console.error); }, INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runChecks() {
    const routes = await this.repositories.proxyRoutes.listEnabled();
    const results = await Promise.allSettled(
      routes.map((route) => this.checkAndUpdate(route))
    );
    const anyChanged = results.some((r) => r.status === "fulfilled" && r.value);
    if (anyChanged) {
      this.gateway.broadcast(["proxy-routes", "proxy-runtime-metrics"]);
    }
  }

  private async checkAndUpdate(route: ProxyRoute): Promise<boolean> {
    const newStatus = await this.probe(route);
    if (newStatus === route.healthStatus) return false;
    await this.repositories.proxyRoutes.updateHealthStatus(route.id, newStatus);
    return true;
  }

  private probe(route: ProxyRoute): Promise<"healthy" | "degraded" | "unknown"> {
    if (route.protocol === "udp") return Promise.resolve("unknown");
    if (route.targetProtocol === "http" || route.targetProtocol === "https") {
      return this.probeHttp(route.targetProtocol, route.targetHost, route.targetPort);
    }
    return this.probeTcp(route.targetHost, route.targetPort);
  }

  private probeHttp(protocol: "http" | "https", host: string, port: number): Promise<"healthy" | "degraded"> {
    return new Promise((resolve) => {
      const mod = protocol === "https" ? https : http;
      const req = mod.request(
        { host, port, path: "/", method: "HEAD", timeout: TIMEOUT_MS, rejectUnauthorized: false },
        (res) => {
          resolve(res.statusCode && res.statusCode < 500 ? "healthy" : "degraded");
        }
      );
      req.on("error", () => resolve("degraded"));
      req.on("timeout", () => { req.destroy(); resolve("degraded"); });
      req.end();
    });
  }

  private probeTcp(host: string, port: number): Promise<"healthy" | "degraded"> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(TIMEOUT_MS);
      socket.connect(port, host, () => { socket.destroy(); resolve("healthy"); });
      socket.on("error", () => resolve("degraded"));
      socket.on("timeout", () => { socket.destroy(); resolve("degraded"); });
    });
  }
}
