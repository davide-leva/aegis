import dgram from "node:dgram";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { parentPort } from "node:worker_threads";
import tls from "node:tls";
import { URL } from "node:url";

import httpProxy from "http-proxy";

import { createDb } from "../db/client.js";
import { createPrivilegedPortError, hasPrivilegedPortAccess, isPrivilegedPort, normalizePrivilegedBindError } from "../lib/privileged-ports.js";
import { createRepositories } from "../repositories/index.js";
import type { ProxyRequestLogEntry, ProxyRoute, ProxyRuntimeStatus } from "../types.js";

type ListenerHandle = { close: () => Promise<void> };

const db = createDb();
const repositories = createRepositories(db);

let listeners: ListenerHandle[] = [];
let heartbeatTimer: NodeJS.Timeout | null = null;
let status: ProxyRuntimeStatus = {
  state: "starting",
  pid: process.pid,
  restarts: 0,
  lastStartedAt: new Date().toISOString(),
  lastHeartbeatAt: null,
  lastError: null,
  listeners: []
};

function pushStatus(partial: Partial<ProxyRuntimeStatus> = {}) {
  status = {
    ...status,
    ...partial,
    lastHeartbeatAt: new Date().toISOString()
  };
  parentPort?.postMessage({ type: "status", status });
}

async function stopListeners() {
  const current = listeners;
  listeners = [];
  await Promise.all(
    current.map(async (listener) => {
      try {
        await listener.close();
      } catch (error) {
        console.error("Failed to close proxy listener", error);
      }
    })
  );
}

async function loadConfiguration() {
  const routes = (await repositories.proxyRoutes.listEnabled()).map(normalizeRoute);
  if (routes.length === 0) {
    await stopListeners();
    pushStatus({
      state: "idle",
      lastError: null,
      listeners: []
    });
    return;
  }

  await stopListeners();
  const nextListeners: ListenerHandle[] = [];
  const listenerState: ProxyRuntimeStatus["listeners"] = [];

  try {
    const grouped = groupRoutes(routes);
    assertNoListenerConflicts(Array.from(grouped.values()));
    const privilegedListeners = Array.from(grouped.values())
      .filter((group) => isPrivilegedPort(group.listenPort))
      .map((group) => ({
        runtime: "proxy" as const,
        protocol: group.protocol,
        address: group.listenAddress,
        port: group.listenPort
      }));
    if (privilegedListeners.length > 0 && !hasPrivilegedPortAccess()) {
      throw createPrivilegedPortError(privilegedListeners);
    }
    const httpsRoutes = grouped.get("https:0.0.0.0:443")?.routes ?? [];
    for (const [key, group] of grouped.entries()) {
      const handle = await createListener(group, httpsRoutes);
      nextListeners.push(handle);
      listenerState.push({
        protocol: group.protocol,
        address: group.listenAddress,
        port: group.listenPort,
        routeCount: group.routes.length
      });
    }
    listeners = nextListeners;
    pushStatus({
      state: "running",
      lastError: null,
      listeners: listenerState
    });
  } catch (error) {
    await Promise.all(nextListeners.map((listener) => listener.close().catch(() => undefined)));
    const normalized = normalizePrivilegedBindError(
      error,
      routes
        .filter((route) => isPrivilegedPort(route.listenPort))
        .map((route) => ({
          runtime: "proxy" as const,
          protocol: route.protocol,
          address: route.listenAddress,
          port: route.listenPort
        }))
    );
    const message = normalized.message;
    parentPort?.postMessage({ type: "runtime-error", error: message });
    pushStatus({
      state: "error",
      lastError: message,
      listeners: []
    });
    throw error;
  }
}

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    pushStatus();
  }, 5000);
}

async function shutdown(code = 0) {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  await stopListeners();
  pushStatus({
    state: "stopped",
    listeners: []
  });
  process.exit(code);
}

parentPort?.on("message", (message) => {
  if (message?.type === "reload") {
    void loadConfiguration().catch(handleFatalError);
  }
  if (message?.type === "stop") {
    void shutdown(0);
  }
});

process.on("uncaughtException", (error) => {
  parentPort?.postMessage({ type: "runtime-error", error: error.message });
  void shutdown(1);
});

process.on("unhandledRejection", (error) => {
  const message = error instanceof Error ? error.message : String(error);
  parentPort?.postMessage({ type: "runtime-error", error: message });
  void shutdown(1);
});

void (async function main() {
  startHeartbeat();
  await loadConfiguration();
})();

function handleFatalError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  parentPort?.postMessage({ type: "runtime-error", error: message });
}

type RouteGroup = {
  protocol: ProxyRoute["protocol"];
  listenAddress: string;
  listenPort: number;
  routes: ProxyRoute[];
};

function groupRoutes(routes: ProxyRoute[]) {
  const groups = new Map<string, RouteGroup>();
  for (const route of routes) {
    const key = `${route.protocol}:${route.listenAddress}:${route.listenPort}`;
    const group = groups.get(key);
    if (group) {
      group.routes.push(route);
      continue;
    }
    groups.set(key, {
      protocol: route.protocol,
      listenAddress: route.listenAddress,
      listenPort: route.listenPort,
      routes: [route]
    });
  }
  return groups;
}

function assertNoListenerConflicts(groups: RouteGroup[]) {
  for (let index = 0; index < groups.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < groups.length; nextIndex += 1) {
      const current = groups[index];
      const next = groups[nextIndex];
      if (!listenerGroupsConflict(current, next)) {
        continue;
      }
      throw new Error(
        `Listener conflict: ${describeListener(current.protocol, current.listenAddress, current.listenPort)} overlaps with ${describeListener(next.protocol, next.listenAddress, next.listenPort)}`
      );
    }
  }
}

function listenerGroupsConflict(left: RouteGroup, right: RouteGroup) {
  if (left.listenPort !== right.listenPort) {
    return false;
  }

  if (transportFamily(left.protocol) !== transportFamily(right.protocol)) {
    return false;
  }

  if (left.protocol === right.protocol && left.listenAddress === right.listenAddress) {
    return false;
  }

  return addressesOverlap(left.listenAddress, right.listenAddress);
}

function transportFamily(protocol: ProxyRoute["protocol"]) {
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

async function createListener(group: RouteGroup, httpsRoutes: ProxyRoute[] = []): Promise<ListenerHandle> {
  if (group.protocol === "http" || group.protocol === "https") {
    return createHttpListener(group, httpsRoutes);
  }
  if (group.protocol === "tcp") {
    return createTcpListener(group);
  }
  return createUdpListener(group);
}

async function createHttpListener(group: RouteGroup, httpsRoutes: ProxyRoute[] = []): Promise<ListenerHandle> {
  const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const startedAt = Date.now();
    const clientIp = extractClientIp(req.socket.remoteAddress);
    const hostHeader = (req.headers.host ?? "").split(":")[0].toLowerCase();
    const pathname = req.url ? new URL(req.url, "http://proxy.local").pathname : "/";
    const route = selectHttpRoute(group.routes, hostHeader, pathname);

    if (!route) {
      if (group.protocol === "http" && selectHttpRoute(httpsRoutes, hostHeader, pathname)) {
        const location = `https://${hostHeader}${req.url ?? "/"}`;
        res.writeHead(301, { Location: location });
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end("No proxy route matched");
      await logProxyRequest({
        routeId: null,
        routeName: null,
        protocol: group.protocol,
        clientIp,
        targetHost: null,
        targetPort: null,
        outcome: "rejected",
        statusCode: 404,
        bytesIn: Number(req.headers["content-length"] ?? 0),
        bytesOut: 0,
        durationMs: Date.now() - startedAt,
        metadata: JSON.stringify({
          host: hostHeader || null,
          path: pathname
        })
      });
      return;
    }

    const target = `${route.targetProtocol}://${route.targetHost}:${route.targetPort}`;
    const proxy = httpProxy.createProxyServer({
      target,
      changeOrigin: !route.preserveHost,
      xfwd: true,
      secure: false
    });

    let bytesOut = 0;
    let logged = false;
    let statusCode: number | null = null;

    proxy.on("proxyRes", (proxyRes) => {
      statusCode = proxyRes.statusCode ?? 200;
      proxyRes.on("data", (chunk) => {
        bytesOut += Buffer.byteLength(chunk);
      });
      proxyRes.on("end", () => {
        void finalize("proxied");
      });
    });

    proxy.on("error", (error) => {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end("Upstream proxy error");
      }
      void finalize("error", error.message, 502);
    });

    res.on("close", () => {
      void finalize(statusCode && statusCode < 500 ? "proxied" : "error");
    });

    proxy.web(req, res, {
      preserveHeaderKeyCase: true
    });

    async function finalize(outcome: ProxyRequestLogEntry["outcome"], error?: string, fallbackStatus?: number) {
      if (logged) {
        return;
      }
      logged = true;
      proxy.removeAllListeners();
      const contentLength = Number(req.headers["content-length"] ?? 0);
      await logProxyRequest({
        routeId: route.id,
        routeName: route.name,
        protocol: group.protocol,
        clientIp,
        targetHost: route.targetHost,
        targetPort: route.targetPort,
        outcome,
        statusCode: statusCode ?? fallbackStatus ?? null,
        bytesIn: Number.isFinite(contentLength) ? contentLength : 0,
        bytesOut,
        durationMs: Date.now() - startedAt,
        metadata: JSON.stringify({
          method: req.method,
          host: hostHeader || null,
          path: pathname,
          error: error ?? null
        })
      });
    }
  };

  const server =
    group.protocol === "https"
      ? https.createServer(
          {
            cert: selectDefaultTlsRoute(group.routes)?.tlsCertPem ?? undefined,
            key: selectDefaultTlsRoute(group.routes)?.tlsKeyPem ?? undefined,
            SNICallback: createSniCallback(group.routes)
          },
          requestHandler
        )
      : http.createServer(requestHandler);

  await listenServer(server, group.listenPort, group.listenAddress);
  return {
    close: () => closeServer(server)
  };
}

function createTcpListener(group: RouteGroup): Promise<ListenerHandle> {
  const route = group.routes[0];
  const server = net.createServer((clientSocket) => {
    const startedAt = Date.now();
    const upstreamSocket = net.createConnection({
      host: route.targetHost,
      port: route.targetPort
    });
    let bytesIn = 0;
    let bytesOut = 0;
    let logged = false;
    let hadError = false;

    clientSocket.on("data", (chunk) => {
      bytesIn += chunk.length;
    });
    upstreamSocket.on("data", (chunk) => {
      bytesOut += chunk.length;
    });

    const finalize = async (outcome: ProxyRequestLogEntry["outcome"], error?: string) => {
      if (logged) {
        return;
      }
      logged = true;
      await logProxyRequest({
        routeId: route.id,
        routeName: route.name,
        protocol: "tcp",
        clientIp: extractClientIp(clientSocket.remoteAddress),
        targetHost: route.targetHost,
        targetPort: route.targetPort,
        outcome,
        statusCode: null,
        bytesIn,
        bytesOut,
        durationMs: Date.now() - startedAt,
        metadata: JSON.stringify({
          error: error ?? null
        })
      });
    };

    const handleError = (error: Error) => {
      hadError = true;
      clientSocket.destroy();
      upstreamSocket.destroy();
      void finalize("error", error.message);
    };

    clientSocket.on("error", handleError);
    upstreamSocket.on("error", handleError);

    upstreamSocket.on("connect", () => {
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);
    });

    clientSocket.on("close", () => {
      if (!hadError) {
        void finalize("proxied");
      }
    });
  });

  return listenServer(server, group.listenPort, group.listenAddress).then(() => ({
    close: () => closeServer(server)
  }));
}

function createSniCallback(routes: ProxyRoute[]) {
  const contexts = new Map<string, tls.SecureContext>();

  for (const route of routes) {
    if (!route.sourceHost || !route.tlsCertPem || !route.tlsKeyPem) {
      continue;
    }
    contexts.set(
      route.sourceHost.toLowerCase(),
      tls.createSecureContext({
        cert: route.tlsCertPem,
        key: route.tlsKeyPem
      })
    );
  }

  return (servername: string, callback: (error: Error | null, context?: tls.SecureContext) => void) => {
    callback(null, contexts.get(servername.toLowerCase()));
  };
}

function selectDefaultTlsRoute(routes: ProxyRoute[]) {
  return (
    routes.find((route) => route.sourceHost == null && route.tlsCertPem && route.tlsKeyPem) ??
    routes.find((route) => route.tlsCertPem && route.tlsKeyPem) ??
    null
  );
}

function createUdpListener(group: RouteGroup): Promise<ListenerHandle> {
  const route = group.routes[0];
  const socket = dgram.createSocket("udp4");

  socket.on("message", (message, remote) => {
    const startedAt = Date.now();
    const upstream = dgram.createSocket("udp4");
    let bytesOut = 0;
    let completed = false;

    const finalize = async (outcome: ProxyRequestLogEntry["outcome"], error?: string) => {
      if (completed) {
        return;
      }
      completed = true;
      upstream.close();
      await logProxyRequest({
        routeId: route.id,
        routeName: route.name,
        protocol: "udp",
        clientIp: remote.address,
        targetHost: route.targetHost,
        targetPort: route.targetPort,
        outcome,
        statusCode: null,
        bytesIn: message.length,
        bytesOut,
        durationMs: Date.now() - startedAt,
        metadata: JSON.stringify({
          error: error ?? null
        })
      });
    };

    upstream.once("message", (response) => {
      bytesOut = response.length;
      socket.send(response, remote.port, remote.address, (error) => {
        if (error) {
          void finalize("error", error.message);
          return;
        }
        void finalize("proxied");
      });
    });

    upstream.once("error", (error) => {
      void finalize("error", error.message);
    });

    upstream.send(message, route.targetPort, route.targetHost, (error) => {
      if (error) {
        void finalize("error", error.message);
      }
    });

    setTimeout(() => {
      void finalize("error", "UDP upstream timed out");
    }, 4000);
  });

  socket.on("error", (error) => {
    parentPort?.postMessage({ type: "runtime-error", error: error.message });
  });

  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(group.listenPort, group.listenAddress, () => {
      socket.removeListener("error", reject);
      resolve({
        close: () =>
          new Promise<void>((closeResolve) => {
            socket.close(() => closeResolve());
          })
      });
    });
  });
}

function selectHttpRoute(routes: ProxyRoute[], hostHeader: string, pathname: string) {
  const candidates = routes.filter((route) => {
    const routeHost = route.sourceHost?.toLowerCase() ?? null;
    const routePath = normalizePath(route.sourcePath);
    const hostMatches = routeHost ? routeHost === hostHeader : true;
    const pathMatches = pathname.startsWith(routePath);
    return hostMatches && pathMatches;
  });

  candidates.sort((left, right) => normalizePath(right.sourcePath).length - normalizePath(left.sourcePath).length);
  return candidates[0] ?? null;
}

function normalizePath(pathname: string | null) {
  if (!pathname || pathname.trim() === "") {
    return "/";
  }
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function normalizeRoute(route: ProxyRoute): ProxyRoute {
  return {
    ...route,
    sourceHost: route.sourceHost?.toLowerCase() ?? null,
    sourcePath: normalizePath(route.sourcePath),
    listenAddress: (route.protocol === "http" || route.protocol === "https") ? "0.0.0.0" : route.listenAddress
  };
}

function extractClientIp(address: string | null | undefined) {
  return address ? address.replace(/^::ffff:/, "") : null;
}

function listenServer(server: net.Server | http.Server | https.Server, port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function closeServer(server: net.Server | http.Server | https.Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function logProxyRequest(input: Omit<ProxyRequestLogEntry, "id" | "createdAt">) {
  try {
    await repositories.proxyLogs.create({
      ...input
    });
  } catch (error) {
    console.error("Failed to persist proxy request log", error);
  }
}
