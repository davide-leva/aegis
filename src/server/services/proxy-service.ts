import { EventBus } from "../events/event-bus.js";
import type { AuditContext, ProxyRuntimeStatus } from "../types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type { NewProxyRoute } from "../repositories/proxy-route-repository.js";

interface RuntimeControl {
  requestReload(): void;
  getStatus(): ProxyRuntimeStatus;
}

export class ProxyService {
  constructor(
    private readonly repositories: Repositories,
    private readonly eventBus: EventBus,
    private readonly runtimeControl?: RuntimeControl
  ) {}

  async getDashboard(context: AuditContext) {
    const routes = await this.repositories.proxyRoutes.list();
    const dashboard = {
      summary: {
        routes: routes.length,
        enabledRoutes: routes.filter((route) => route.enabled).length,
        httpListeners: countListenerGroups(routes, ["http", "https"]),
        tcpListeners: countListenerGroups(routes, ["tcp"]),
        udpListeners: countListenerGroups(routes, ["udp"])
      },
      routes
    };

    await this.audit("proxy.dashboard.read", "proxy_dashboard", null, context, {
      summary: dashboard.summary
    });

    return dashboard;
  }

  async listRoutes(context: AuditContext) {
    const routes = await this.repositories.proxyRoutes.list();
    await this.audit("proxy.route.list", "proxy_route", null, context, {
      count: routes.length
    });
    return routes;
  }

  async createRoute(input: NewProxyRoute, context: AuditContext) {
    await this.validateRouteInput(input);
    const route = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      await this.validateRouteInput(input, repos);
      const route = await repos.proxyRoutes.create(input);
      await repos.audit.create({
        action: "proxy.route.create",
        entityType: "proxy_route",
        entityId: route?.id ? String(route.id) : null,
        payload: route ?? null,
        context
      });
      if (route?.id) {
        await events.publish({
          topic: "proxy.route.created",
          aggregateType: "proxy_route",
          aggregateId: String(route.id),
          payload: route,
          context
        });
      }
      return route;
    });
    this.runtimeControl?.requestReload();
    return route;
  }

  async updateRoute(id: number, input: NewProxyRoute, context: AuditContext) {
    await this.validateRouteInput(input, this.repositories, id);
    const route = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.proxyRoutes.getById(id);
      if (!existing) {
        throw new Error("Proxy route not found");
      }
      await this.validateRouteInput(input, repos, id);
      const route = await repos.proxyRoutes.update(id, input);
      await repos.audit.create({
        action: "proxy.route.update",
        entityType: "proxy_route",
        entityId: String(id),
        payload: { before: existing, after: route },
        context
      });
      if (route) {
        await events.publish({
          topic: "proxy.route.updated",
          aggregateType: "proxy_route",
          aggregateId: String(id),
          payload: route,
          context
        });
      }
      return route;
    });
    this.runtimeControl?.requestReload();
    return route;
  }

  async deleteRoute(id: number, context: AuditContext) {
    const route = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.proxyRoutes.delete(id);
      if (!existing) {
        throw new Error("Proxy route not found");
      }
      await repos.audit.create({
        action: "proxy.route.delete",
        entityType: "proxy_route",
        entityId: String(id),
        payload: existing,
        context
      });
      await events.publish({
        topic: "proxy.route.deleted",
        aggregateType: "proxy_route",
        aggregateId: String(id),
        payload: existing,
        context
      });
      return existing;
    });
    this.runtimeControl?.requestReload();
    return route;
  }

  async listAuditLogs(context: AuditContext, limit = 100) {
    const logs = await this.repositories.audit.list(Math.max(limit * 3, limit));
    const filtered = logs
      .filter((entry) => entry.action.startsWith("proxy."))
      .slice(0, limit);
    await this.audit("proxy.runtime.logs.read", "proxy_audit", null, context, {
      count: filtered.length,
      limit
    });
    return filtered;
  }

  async listEvents(context: AuditContext, limit = 100) {
    const events = await this.repositories.events.list(Math.max(limit * 3, limit));
    const filtered = events
      .filter((entry) => entry.topic.startsWith("proxy."))
      .slice(0, limit);
    await this.audit("proxy.runtime.logs.read", "proxy_events", null, context, {
      count: filtered.length,
      limit
    });
    return filtered;
  }

  async getRuntimeStatus(context: AuditContext) {
    const status = this.runtimeControl?.getStatus() ?? {
      state: "stopped",
      pid: null,
      restarts: 0,
      lastStartedAt: null,
      lastHeartbeatAt: null,
      lastError: "Runtime manager unavailable",
      listeners: []
    };
    await this.audit("proxy.runtime.status.read", "proxy_runtime", null, context, {
      state: status.state,
      listeners: status.listeners.length
    });
    return status;
  }

  async getRuntimeMetrics(context: AuditContext) {
    const metrics = await this.repositories.proxyLogs.getMetrics();
    await this.audit("proxy.runtime.metrics.read", "proxy_runtime", null, context, {
      ...metrics
    });
    return metrics;
  }

  async listRuntimeLogs(context: AuditContext, limit = 100) {
    const logs = await this.repositories.proxyLogs.listRecent(limit);
    await this.audit("proxy.runtime.logs.read", "proxy_runtime", null, context, {
      count: logs.length,
      limit
    });
    return logs;
  }

  private async audit(
    action:
      | "proxy.dashboard.read"
      | "proxy.route.list"
      | "proxy.runtime.status.read"
      | "proxy.runtime.metrics.read"
      | "proxy.runtime.logs.read",
    entityType: string,
    entityId: string | null,
    context: AuditContext,
    payload: Record<string, unknown>
  ) {
    await this.repositories.audit.create({
      action,
      entityType,
      entityId,
      payload,
      context
    });
  }

  private async validateRouteInput(input: NewProxyRoute, repos = this.repositories, currentId?: number) {
    if (input.protocol === "https" && (!input.tlsCertPem || !input.tlsKeyPem)) {
      throw new Error("HTTPS routes require both TLS certificate and private key");
    }

    if (input.protocol === "http" && (input.tlsCertPem || input.tlsKeyPem)) {
      throw new Error("HTTP routes cannot store TLS material");
    }

    if ((input.protocol === "tcp" || input.protocol === "udp") && (input.sourceHost || input.sourcePath)) {
      throw new Error("TCP and UDP routes cannot use host or path matching");
    }

    if ((input.protocol === "tcp" && input.targetProtocol !== "tcp") || (input.protocol === "udp" && input.targetProtocol !== "udp")) {
      throw new Error("TCP/UDP routes must target the same transport protocol");
    }

    if ((input.protocol === "http" || input.protocol === "https") && !["http", "https"].includes(input.targetProtocol)) {
      throw new Error("HTTP and HTTPS routes can only target HTTP or HTTPS upstreams");
    }

    const normalizedHost = normalizeHost(input.sourceHost);
    const normalizedPath = normalizePath(input.sourcePath);
    const routes = await repos.proxyRoutes.list();

    for (const route of routes) {
      if (currentId && route.id === currentId) {
        continue;
      }
      if (
        route.protocol === input.protocol &&
        route.listenAddress === input.listenAddress &&
        route.listenPort === input.listenPort
      ) {
        if (input.protocol === "tcp" || input.protocol === "udp") {
          throw new Error(`A ${input.protocol.toUpperCase()} listener already exists on ${input.listenAddress}:${input.listenPort}`);
        }

        const existingHost = normalizeHost(route.sourceHost);
        const existingPath = normalizePath(route.sourcePath);
        if (existingHost === normalizedHost && existingPath === normalizedPath) {
          throw new Error("A proxy route with the same listener, host and path already exists");
        }

        if (input.protocol === "https") {
          const hasDifferentTls =
            (route.tlsCertPem ?? "") !== (input.tlsCertPem ?? "") || (route.tlsKeyPem ?? "") !== (input.tlsKeyPem ?? "");
          if (hasDifferentTls) {
            throw new Error("HTTPS routes sharing the same listener must use the same certificate pair");
          }
        }
      }
    }
  }
}

function normalizeHost(value: string | null) {
  return value?.trim().toLowerCase() || "*";
}

function normalizePath(value: string | null) {
  if (!value || value.trim() === "") {
    return "/";
  }
  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function countListenerGroups(routes: Array<{ protocol: string; enabled: boolean; listenAddress: string; listenPort: number }>, protocols: string[]) {
  const keys = new Set(
    routes
      .filter((route) => route.enabled && protocols.includes(route.protocol))
      .map((route) => `${route.protocol}:${route.listenAddress}:${route.listenPort}`)
  );
  return keys.size;
}
