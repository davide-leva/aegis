import { Worker } from "node:worker_threads";

import { EventBus } from "../events/event-bus.js";
import type { AuditContext, ProxyRuntimeStatus } from "../types.js";
import type { Repositories } from "../repositories/index.js";
import type { WsGateway } from "../ws/gateway.js";

const systemContext: AuditContext = {
  actorType: "system",
  actorId: "proxy-runtime-manager",
  sourceIp: null,
  userAgent: "aegis-proxy-runtime-manager"
};

export class ProxyRuntimeManager {
  private worker: Worker | null = null;
  private restartCount = 0;
  private readonly baseRestartDelay = 1000;
  private readonly maxRestartDelay = 30000;
  private shuttingDown = false;
  private logDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private status: ProxyRuntimeStatus = {
    state: "starting",
    pid: null,
    restarts: 0,
    lastStartedAt: null,
    lastHeartbeatAt: null,
    lastError: null,
    listeners: []
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

  requestReload() {
    this.worker?.postMessage({ type: "reload" });
  }

  private notifyNewLogs() {
    if (this.logDebounceTimer) clearTimeout(this.logDebounceTimer);
    this.logDebounceTimer = setTimeout(() => {
      this.gateway.broadcast(["proxy-runtime-logs", "proxy-runtime-metrics"]);
      this.logDebounceTimer = null;
    }, 500);
  }

  private spawnWorker(isRestart: boolean) {
    this.worker = new Worker(this.workerUrl);
    const action = isRestart ? "proxy.runtime.worker.restart" : "proxy.runtime.worker.start";
    const topic = isRestart ? "proxy.runtime.restarted" : "proxy.runtime.started";
    const now = new Date().toISOString();
    this.status = {
      ...this.status,
      state: "starting",
      pid: this.worker.threadId,
      restarts: isRestart ? this.status.restarts + 1 : this.status.restarts,
      lastStartedAt: now,
      lastError: null
    };
    this.gateway.broadcast(["proxy-runtime-status"]);

    void this.recordSystemEvent(action, topic, {
      pid: this.worker.threadId,
      startedAt: now
    }).catch((error) => {
      console.error("Failed to record proxy runtime start event", error);
    });

    this.worker.on("message", (message: any) => {
      if (message.type === "status") {
        const nextStatus = message.status as ProxyRuntimeStatus;
        if (nextStatus.state === "running") this.restartCount = 0;
        this.status = {
          ...this.status,
          ...nextStatus,
          pid: this.worker?.threadId ?? nextStatus.pid,
          restarts: this.status.restarts,
          lastStartedAt: this.status.lastStartedAt ?? nextStatus.lastStartedAt
        };
        this.gateway.broadcast(["proxy-runtime-status", "proxy-runtime-metrics"]);
      }
      if (message.type === "log-written") {
        this.notifyNewLogs();
      }
      if (message.type === "runtime-error") {
        this.status = {
          ...this.status,
          state: "error",
          lastError: String(message.error)
        };
        this.gateway.broadcast(["proxy-runtime-status"]);
        void this.recordSystemEvent("proxy.runtime.worker.error", "proxy.runtime.error", {
          error: String(message.error)
        }).catch((error) => {
          console.error("Failed to record proxy runtime error event", error);
        });
      }
    });

    this.worker.on("error", (error) => {
      this.status = {
        ...this.status,
        state: "error",
        lastError: error.message
      };
      this.gateway.broadcast(["proxy-runtime-status"]);
      void this.recordSystemEvent("proxy.runtime.worker.error", "proxy.runtime.error", {
        error: error.message
      }).catch((recordError) => {
        console.error("Failed to record proxy worker error", recordError);
      });
    });

    this.worker.on("exit", (code) => {
      this.status = {
        ...this.status,
        state: this.shuttingDown ? "stopped" : "error",
        pid: null,
        listeners: []
      };
      this.gateway.broadcast(["proxy-runtime-status"]);

      void this.recordSystemEvent("proxy.runtime.worker.exit", "proxy.runtime.exited", { code }).catch((error) => {
        console.error("Failed to record proxy worker exit", error);
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
    action:
      | "proxy.runtime.worker.start"
      | "proxy.runtime.worker.restart"
      | "proxy.runtime.worker.exit"
      | "proxy.runtime.worker.error",
    topic: "proxy.runtime.started" | "proxy.runtime.restarted" | "proxy.runtime.exited" | "proxy.runtime.error",
    payload: Record<string, unknown>
  ) {
    await this.repositories.audit.create({
      action,
      entityType: "proxy_runtime",
      entityId: this.status.pid == null ? null : String(this.status.pid),
      payload,
      context: systemContext
    });

    await this.eventBus.publish({
      topic,
      aggregateType: "proxy_runtime",
      aggregateId: this.status.pid == null ? "runtime" : String(this.status.pid),
      payload,
      context: systemContext
    });
  }
}
