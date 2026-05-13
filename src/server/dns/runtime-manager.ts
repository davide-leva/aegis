import { Worker } from "node:worker_threads";

import { EventBus } from "../events/event-bus.js";
import type { AuditContext, DnsRuntimeStatus } from "../types.js";
import type { Repositories } from "../repositories/index.js";
import type { WsGateway } from "../ws/gateway.js";

const systemContext: AuditContext = {
  actorType: "system",
  actorId: "dns-runtime-manager",
  sourceIp: null,
  userAgent: "aegis-runtime-manager"
};

export class DnsRuntimeManager {
  private worker: Worker | null = null;
  private restartCount = 0;
  private readonly baseRestartDelay = 1000;
  private readonly maxRestartDelay = 30000;
  private shuttingDown = false;
  private logDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private cacheMetrics = { cacheSize: 0, cacheHits: 0, cacheMisses: 0 };
  private status: DnsRuntimeStatus = {
    state: "starting",
    pid: null,
    restarts: 0,
    lastStartedAt: null,
    lastHeartbeatAt: null,
    lastError: null,
    listening: {
      udpPort: null,
      tcpPort: null,
      address: null
    }
  };

  constructor(
    private readonly repositories: Repositories,
    private readonly eventBus: EventBus,
    private readonly workerUrl: URL,
    private readonly gateway: WsGateway
  ) {}

  start() {
    this.spawnWorker(false);
  }

  async stop() {
    this.shuttingDown = true;
    if (this.logDebounceTimer) clearTimeout(this.logDebounceTimer);
    if (!this.worker) {
      return;
    }
    this.worker.postMessage({ type: "stop" });
    await this.worker.terminate();
    this.worker = null;
  }

  getStatus() {
    return this.status;
  }

  getCacheMetrics() {
    return this.cacheMetrics;
  }

  requestReload() {
    this.worker?.postMessage({ type: "reload" });
  }

  private notifyNewLogs() {
    if (this.logDebounceTimer) clearTimeout(this.logDebounceTimer);
    this.logDebounceTimer = setTimeout(() => {
      this.gateway.broadcast(["dns-runtime-logs", "dns-runtime-metrics"]);
      this.logDebounceTimer = null;
    }, 500);
  }

  private spawnWorker(isRestart: boolean) {
    this.worker = new Worker(this.workerUrl);

    const action = isRestart ? "runtime.worker.restart" : "runtime.worker.start";
    const topic = isRestart ? "dns.runtime.restarted" : "dns.runtime.started";
    const now = new Date().toISOString();
    this.status = {
      ...this.status,
      state: "starting",
      pid: this.worker.threadId,
      restarts: isRestart ? this.status.restarts + 1 : this.status.restarts,
      lastStartedAt: now,
      lastError: null
    };
    this.gateway.broadcast(["dns-runtime-status"]);
    void this.recordSystemEvent(action, topic, {
      pid: this.worker.threadId,
      startedAt: now
    }).catch((error) => {
      console.error("Failed to record runtime start event", error);
    });

    this.worker.on("message", (message: any) => {
      if (message.type === "status") {
        const nextStatus = message.status as DnsRuntimeStatus;
        if (nextStatus.state === "running") this.restartCount = 0;
        this.status = {
          ...this.status,
          ...nextStatus,
          pid: this.worker?.threadId ?? nextStatus.pid,
          restarts: this.status.restarts,
          lastStartedAt: this.status.lastStartedAt ?? nextStatus.lastStartedAt
        };
        this.gateway.broadcast(["dns-runtime-status", "dns-runtime-metrics"]);
      }
      if (message.type === "log-written") {
        this.notifyNewLogs();
      }
      if (message.type === "cache-metrics") {
        this.cacheMetrics = {
          cacheSize: message.cacheSize as number,
          cacheHits: message.cacheHits as number,
          cacheMisses: message.cacheMisses as number
        };
      }
      if (message.type === "runtime-error") {
        this.status = {
          ...this.status,
          state: "error",
          lastError: String(message.error)
        };
        this.gateway.broadcast(["dns-runtime-status"]);
        void this.recordSystemEvent("runtime.worker.error", "dns.runtime.error", {
          error: String(message.error)
        }).catch((error) => {
          console.error("Failed to record runtime error event", error);
        });
      }
    });

    this.worker.on("error", (error) => {
      this.status = {
        ...this.status,
        state: "error",
        lastError: error.message
      };
      this.gateway.broadcast(["dns-runtime-status"]);
      void this.recordSystemEvent("runtime.worker.error", "dns.runtime.error", {
        error: error.message
      }).catch((recordError) => {
        console.error("Failed to record worker error", recordError);
      });
    });

    this.worker.on("exit", (code) => {
      this.status = {
        ...this.status,
        state: this.shuttingDown ? "stopped" : "error",
        pid: null,
        listening: {
          udpPort: null,
          tcpPort: null,
          address: null
        }
      };
      this.gateway.broadcast(["dns-runtime-status"]);

      void this.recordSystemEvent("runtime.worker.exit", "dns.runtime.exited", { code }).catch((error) => {
        console.error("Failed to record worker exit", error);
      });

      this.worker = null;
      if (!this.shuttingDown) {
        const delay = Math.min(this.baseRestartDelay * Math.pow(2, this.restartCount), this.maxRestartDelay);
        this.restartCount++;
        setTimeout(() => this.spawnWorker(true), delay);
      }
    });
  }

  private async recordSystemEvent(
    action: "runtime.worker.start" | "runtime.worker.restart" | "runtime.worker.exit" | "runtime.worker.error",
    topic: "dns.runtime.started" | "dns.runtime.restarted" | "dns.runtime.exited" | "dns.runtime.error",
    payload: Record<string, unknown>
  ) {
    await this.repositories.audit.create({
      action,
      entityType: "dns_runtime",
      entityId: this.status.pid == null ? null : String(this.status.pid),
      payload,
      context: systemContext
    });

    await this.eventBus.publish({
      topic,
      aggregateType: "dns_runtime",
      aggregateId: this.status.pid == null ? "runtime" : String(this.status.pid),
      payload,
      context: systemContext
    });
  }
}
