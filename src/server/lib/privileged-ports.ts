import fs from "node:fs";

import type { ProxyRoute, ResolverSettings } from "../types.js";

type RuntimeKind = "dns" | "proxy";

export type PrivilegedPortListener = {
  runtime: RuntimeKind;
  protocol: string;
  address: string;
  port: number;
};

const CAP_NET_BIND_SERVICE = 10n;

export function isPrivilegedPort(port: number) {
  return port > 0 && port < 1024;
}

export function getPrivilegedPortListeners(input: {
  resolverSettings: ResolverSettings | null;
  proxyRoutes: ProxyRoute[];
}) {
  const listeners: PrivilegedPortListener[] = [];
  if (input.resolverSettings && isPrivilegedPort(input.resolverSettings.dnsListenPort)) {
    listeners.push(
      { runtime: "dns", protocol: "udp", address: process.env.DNS_BIND_ADDRESS ?? "0.0.0.0", port: input.resolverSettings.dnsListenPort },
      { runtime: "dns", protocol: "tcp", address: process.env.DNS_BIND_ADDRESS ?? "0.0.0.0", port: input.resolverSettings.dnsListenPort }
    );
  }

  const seen = new Set<string>();
  for (const route of input.proxyRoutes.filter((entry) => entry.enabled && isPrivilegedPort(entry.listenPort))) {
    const key = `${route.protocol}:${route.listenAddress}:${route.listenPort}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    listeners.push({
      runtime: "proxy",
      protocol: route.protocol,
      address: route.listenAddress,
      port: route.listenPort
    });
  }

  return listeners;
}

export function hasPrivilegedPortAccess() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return true;
  }

  if (process.platform !== "linux") {
    return false;
  }

  try {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const capEffLine = status
      .split("\n")
      .find((line) => line.startsWith("CapEff:"));
    if (!capEffLine) {
      return false;
    }
    const rawValue = capEffLine.split(":")[1]?.trim();
    if (!rawValue) {
      return false;
    }
    const effective = BigInt(`0x${rawValue}`);
    return (effective & (1n << CAP_NET_BIND_SERVICE)) !== 0n;
  } catch {
    return false;
  }
}

export function createPrivilegedPortError(listeners: PrivilegedPortListener[]) {
  const targets = listeners
    .map((listener) => `${listener.runtime}:${listener.protocol.toUpperCase()} ${listener.address}:${listener.port}`)
    .join(", ");
  const nodePath = process.execPath;

  return new Error(
    [
      `Privileged port bind requires CAP_NET_BIND_SERVICE or root on Linux. Configured listeners: ${targets}.`,
      `Grant capability with: sudo setcap 'cap_net_bind_service=+ep' "${nodePath}"`,
      `Verify with: getcap "${nodePath}"`,
      "Repeat the setcap step after changing or upgrading the Node binary."
    ].join(" ")
  );
}

export function normalizePrivilegedBindError(
  error: unknown,
  listeners: PrivilegedPortListener[]
) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : null;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "EACCES" || message.includes("EACCES")) {
    return createPrivilegedPortError(listeners);
  }
  return error instanceof Error ? error : new Error(message);
}
