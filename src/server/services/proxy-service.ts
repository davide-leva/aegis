import { EventBus } from "../events/event-bus.js";
import { getCanonicalProxyListener } from "../lib/proxy-listeners.js";
import type { AuditContext, NetworkInterface, ProxyRuntimeStatus } from "../types.js";
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
    const [routes, managedRouteIds] = await Promise.all([
      this.repositories.proxyRoutes.list(),
      this.repositories.dockerPortMappings.listManagedProxyRouteIds()
    ]);
    const dashboard = {
      summary: {
        routes: routes.length,
        enabledRoutes: routes.filter((route) => route.enabled).length,
        httpListeners: countListenerGroups(routes, ["http", "https"]),
        tcpListeners: countListenerGroups(routes, ["tcp"]),
        udpListeners: countListenerGroups(routes, ["udp"])
      },
      routes,
      managedRouteIds
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
    const normalizedInput = await normalizeProxyRouteInput(input, this.repositories);
    await this.validateRouteInput(normalizedInput);
    const route = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      await this.validateRouteInput(normalizedInput, repos);
      const route = await repos.proxyRoutes.create(normalizedInput);
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
    const normalizedInput = await normalizeProxyRouteInput(input, this.repositories);
    await this.validateRouteInput(normalizedInput, this.repositories, id);
    const route = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.proxyRoutes.getById(id);
      if (!existing) {
        throw new Error("Proxy route not found");
      }
      await this.validateRouteInput(normalizedInput, repos, id);
      const route = await repos.proxyRoutes.update(id, normalizedInput);
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
    if (input.networkInterfaceId == null) {
      throw new Error("A network interface is required");
    }

    const networkInterface = await repos.networkInterfaces.getById(input.networkInterfaceId);
    if (!networkInterface || !networkInterface.enabled) {
      throw new Error("Selected network interface is not available");
    }

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
      const normalizedRoute = normalizeRouteListenerAddress(route);
      if (listenersConflict(normalizedRoute, input)) {
        throw new Error(
          `Listener conflict: ${describeListener(input.protocol, input.listenAddress, input.listenPort)} overlaps with existing ${describeListener(route.protocol, route.listenAddress, route.listenPort)}`
        );
      }
      if (
        normalizedRoute.protocol === input.protocol &&
        normalizedRoute.listenAddress === input.listenAddress &&
        normalizedRoute.listenPort === input.listenPort
      ) {
        if (input.protocol === "tcp" || input.protocol === "udp") {
          throw new Error(`A ${input.protocol.toUpperCase()} listener already exists on ${input.listenAddress}:${input.listenPort}`);
        }

        const existingHost = normalizeHost(route.sourceHost);
        const existingPath = normalizePath(route.sourcePath);
        if (existingHost === normalizedHost && existingPath === normalizedPath) {
          throw new Error("A proxy route with the same listener, host and path already exists");
        }

      }
    }
  }
}

async function normalizeProxyRouteInput(input: NewProxyRoute, repos: Repositories): Promise<NewProxyRoute> {
  const networkInterface = await resolveNetworkInterface(input.networkInterfaceId, repos);
  const listener = getCanonicalProxyListener(input.protocol, networkInterface.address);
  if (!listener) {
    return {
      ...input,
      networkInterfaceId: networkInterface.id,
      listenAddress: networkInterface.address,
      listenPort: input.listenPort
    };
  }

  return {
    ...input,
    networkInterfaceId: networkInterface.id,
    listenAddress: listener.listenAddress,
    listenPort: listener.listenPort
  };
}

async function resolveNetworkInterface(networkInterfaceId: number | null, repos: Repositories): Promise<NetworkInterface> {
  if (networkInterfaceId != null) {
    const exact = await repos.networkInterfaces.getById(networkInterfaceId);
    if (exact) {
      return exact;
    }
  }

  const fallback = await repos.networkInterfaces.getDefault();
  if (!fallback) {
    throw new Error("Configure at least one default network interface before publishing proxy routes");
  }
  return fallback;
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

function normalizeRouteListenerAddress<T extends { protocol: string; listenAddress: string }>(route: T): T {
  if (route.protocol === "http" || route.protocol === "https") {
    return { ...route, listenAddress: "0.0.0.0" };
  }
  return route;
}

function listenersConflict(
  existing: Pick<NewProxyRoute, "protocol" | "listenAddress" | "listenPort">,
  candidate: Pick<NewProxyRoute, "protocol" | "listenAddress" | "listenPort">
) {
  if (existing.listenPort !== candidate.listenPort) {
    return false;
  }

  if (transportFamily(existing.protocol) !== transportFamily(candidate.protocol)) {
    return false;
  }

  if (existing.protocol === candidate.protocol && existing.listenAddress === candidate.listenAddress) {
    return false;
  }

  return addressesOverlap(existing.listenAddress, candidate.listenAddress);
}

function transportFamily(protocol: NewProxyRoute["protocol"]) {
  return protocol === "udp" ? "udp" : "tcp";
}

function addressesOverlap(left: string, right: string) {
  const normalizedLeft = normalizeListenerAddress(left);
  const normalizedRight = normalizeListenerAddress(right);
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  if (isWildcardAddress(normalizedLeft) || isWildcardAddress(normalizedRight)) {
    return sameIpFamily(normalizedLeft, normalizedRight);
  }
  return false;
}

function normalizeListenerAddress(address: string) {
  return address.trim().toLowerCase();
}

function isWildcardAddress(address: string) {
  return address === "0.0.0.0" || address === "::" || address === "[::]";
}

function sameIpFamily(left: string, right: string) {
  if (isIpv4Address(left) && (isIpv4Address(right) || right === "0.0.0.0")) {
    return true;
  }
  if ((left === "::" || left === "[::]" || isIpv6Address(left)) && (right === "::" || right === "[::]" || isIpv6Address(right))) {
    return true;
  }
  return false;
}

function isIpv4Address(address: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address);
}

function isIpv6Address(address: string) {
  return address.includes(":");
}

function describeListener(protocol: string, address: string, port: number) {
  return `${protocol.toUpperCase()} ${address}:${port}`;
}
