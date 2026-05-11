import http from "node:http";
import https from "node:https";

import type { DockerEnvironment } from "../types.js";

type DockerContainerSummary = {
  Id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  Labels?: Record<string, string>;
  State: string;
  Status: string;
  Created: number;
  Ports: Array<{
    IP?: string;
    PrivatePort: number;
    PublicPort?: number;
    Type: "tcp" | "udp";
  }>;
};

type DockerInspectContainer = {
  Id: string;
  Name: string;
  RestartCount: number;
  Config: {
    Image: string;
    Env: string[] | null;
    ExposedPorts?: Record<string, Record<string, never>>;
    Labels?: Record<string, string>;
  };
  HostConfig: {
    RestartPolicy: {
      Name: string;
      MaximumRetryCount: number;
    };
    Memory: number;
    NanoCpus: number;
  } | null;
  State: {
    Status: string;
    Running: boolean;
    Paused: boolean;
    Restarting: boolean;
    OOMKilled: boolean;
    Dead: boolean;
    Pid: number;
    ExitCode: number;
    Error: string;
    StartedAt: string;
    FinishedAt: string;
  };
  NetworkSettings: {
    Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
    Networks: Record<string, { IPAddress: string }>;
  };
};

export type ResolvedDockerContainer = {
  id: string;
  name: string;
  image: string;
  labels: Record<string, string>;
  state: string;
  status: string;
  createdAt: string;
  publishedPorts: Array<{
    privatePort: number;
    publicPort: number | null;
    protocol: "tcp" | "udp";
    hostIp: string | null;
  }>;
};

export type ResolvedDockerContainerDetail = ResolvedDockerContainer & {
  pid: number;
  restartCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  restartPolicy: string;
  memoryLimitBytes: number;
  labels: Record<string, string>;
  networkIps: string[];
  networks: Array<{ name: string; ip: string }>;
  exposedPorts: Array<{
    privatePort: number;
    protocol: "tcp" | "udp";
    publishedBindings: Array<{
      hostIp: string | null;
      publicPort: number;
    }>;
  }>;
};

type DockerContainerStats = {
  cpu_stats: {
    cpu_usage: { total_usage: number; percpu_usage?: number[] };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
  };
  memory_stats: {
    usage: number;
    limit: number;
    stats?: { cache?: number; inactive_file?: number };
  };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
};

export type EnvironmentResourceStats = {
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  sampledContainers: number;
};

export async function getEnvironmentResourceStats(
  environment: DockerEnvironment,
  containerIds: string[]
): Promise<EnvironmentResourceStats> {
  if (containerIds.length === 0) {
    return { cpuPercent: 0, memoryUsedBytes: 0, memoryTotalBytes: 0, networkRxBytes: 0, networkTxBytes: 0, sampledContainers: 0 };
  }

  const results = await Promise.allSettled(
    containerIds.map((id) =>
      dockerRequest<DockerContainerStats>(environment, `/containers/${encodeURIComponent(id)}/stats?stream=false`)
    )
  );

  let cpuTotal = 0;
  let memUsed = 0;
  let memTotal = 0;
  let rxBytes = 0;
  let txBytes = 0;
  let count = 0;

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const s = result.value;

    const cpuDelta = (s.cpu_stats.cpu_usage.total_usage ?? 0) - (s.precpu_stats.cpu_usage.total_usage ?? 0);
    const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
    const numCpus = s.cpu_stats.online_cpus ?? s.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;
    if (sysDelta > 0) cpuTotal += (cpuDelta / sysDelta) * numCpus * 100;

    const cache = s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.cache ?? 0;
    memUsed += Math.max(0, (s.memory_stats.usage ?? 0) - cache);
    if ((s.memory_stats.limit ?? 0) > memTotal) memTotal = s.memory_stats.limit;

    for (const net of Object.values(s.networks ?? {})) {
      rxBytes += net.rx_bytes;
      txBytes += net.tx_bytes;
    }
    count++;
  }

  return {
    cpuPercent: Math.min(100, Math.round(cpuTotal * 10) / 10),
    memoryUsedBytes: memUsed,
    memoryTotalBytes: memTotal,
    networkRxBytes: rxBytes,
    networkTxBytes: txBytes,
    sampledContainers: count
  };
}

export async function listDockerContainers(environment: DockerEnvironment) {
  const items = await dockerRequest<DockerContainerSummary[]>(environment, "/containers/json?all=1");
  return items.map((item) => ({
    id: item.Id,
    name: normalizeContainerName(item.Names[0] ?? item.Id),
    image: item.Image,
    labels: item.Labels ?? {},
    state: item.State,
    status: item.Status,
    createdAt: new Date(item.Created * 1000).toISOString(),
    publishedPorts: item.Ports.map((port) => ({
      privatePort: port.PrivatePort,
      publicPort: port.PublicPort ?? null,
      protocol: port.Type,
      hostIp: port.IP ?? null
    }))
  })) as ResolvedDockerContainer[];
}

export async function inspectDockerContainer(environment: DockerEnvironment, containerId: string) {
  const item = await dockerRequest<DockerInspectContainer>(environment, `/containers/${encodeURIComponent(containerId)}/json`);
  const publishedPorts = Object.entries(item.NetworkSettings.Ports ?? {}).flatMap(([key, bindings]) => {
    const { port, protocol } = splitPortKey(key);
    return (bindings ?? []).map((binding) => ({
      privatePort: port,
      publicPort: Number(binding.HostPort),
      protocol,
      hostIp: binding.HostIp || null
    }));
  });

  const exposedKeys = new Set([
    ...Object.keys(item.Config.ExposedPorts ?? {}),
    ...Object.keys(item.NetworkSettings.Ports ?? {})
  ]);

  return {
    id: item.Id,
    name: normalizeContainerName(item.Name),
    image: item.Config.Image,
    labels: item.Config.Labels ?? {},
    state: item.State.Status,
    status: buildStatus(item.State),
    createdAt: item.State.StartedAt || new Date().toISOString(),
    pid: item.State.Pid,
    restartCount: item.RestartCount ?? 0,
    startedAt: item.State.StartedAt && !item.State.StartedAt.startsWith("0001") ? item.State.StartedAt : null,
    finishedAt: item.State.FinishedAt && !item.State.FinishedAt.startsWith("0001") ? item.State.FinishedAt : null,
    restartPolicy: item.HostConfig?.RestartPolicy?.Name ?? "no",
    memoryLimitBytes: item.HostConfig?.Memory ?? 0,
    publishedPorts,
    networkIps: Object.values(item.NetworkSettings.Networks ?? {})
      .map((network) => network.IPAddress)
      .filter(Boolean),
    networks: Object.entries(item.NetworkSettings.Networks ?? {})
      .map(([name, net]) => ({ name, ip: net.IPAddress }))
      .filter((n) => n.ip),
    exposedPorts: Array.from(exposedKeys).map((key) => {
      const { port, protocol } = splitPortKey(key);
      const bindings = item.NetworkSettings.Ports?.[key] ?? [];
      return {
        privatePort: port,
        protocol,
        publishedBindings: (bindings ?? []).map((binding) => ({
          hostIp: binding.HostIp || null,
          publicPort: Number(binding.HostPort)
        }))
      };
    })
  } satisfies ResolvedDockerContainerDetail;
}

export type DockerContainerEvent = {
  action: "start" | "destroy";
  containerId: string;
  containerName: string;
  labels: Record<string, string>;
};

export function watchDockerContainerEvents(
  environment: DockerEnvironment,
  onEvent: (event: DockerContainerEvent) => void,
  onError: (error: Error) => void
): () => void {
  const isTls = environment.connectionType === "tls";
  const transport = isTls ? https : http;
  const filters = encodeURIComponent(JSON.stringify({ type: ["container"], event: ["start", "destroy"] }));

  const options: http.RequestOptions & https.RequestOptions = {
    method: "GET",
    path: `/events?filters=${filters}`
  };

  if (environment.connectionType === "local_socket") {
    options.socketPath = environment.socketPath ?? "/var/run/docker.sock";
  } else {
    options.host = environment.host ?? "127.0.0.1";
    options.port = environment.port ?? 2375;
  }

  if (isTls) {
    options.ca = environment.tlsCaPem ?? undefined;
    options.cert = environment.tlsCertPem ?? undefined;
    options.key = environment.tlsKeyPem ?? undefined;
    options.rejectUnauthorized = Boolean(environment.tlsCaPem);
  }

  let aborted = false;
  const req = transport.request(options, (res) => {
    let buffer = "";
    res.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const raw = JSON.parse(trimmed) as Record<string, unknown>;
          const action = raw["Action"] as string;
          if (raw["Type"] === "container" && (action === "start" || action === "destroy")) {
            const actor = (raw["Actor"] as Record<string, unknown>) ?? {};
            const attrs = (actor["Attributes"] as Record<string, string>) ?? {};
            onEvent({
              action,
              containerId: (actor["ID"] as string) ?? "",
              containerName: ((attrs["name"] as string) ?? "").replace(/^\//, ""),
              labels: attrs
            });
          }
        } catch {
          // skip malformed line
        }
      }
    });
    res.on("error", (err: Error) => { if (!aborted) onError(err); });
    res.on("end", () => { if (!aborted) onError(new Error("Docker events stream closed")); });
  });

  req.on("error", (err: Error) => { if (!aborted) onError(err); });
  req.end();

  return () => {
    aborted = true;
    req.destroy();
  };
}

async function dockerRequest<T>(environment: DockerEnvironment, requestPath: string): Promise<T> {
  const isTls = environment.connectionType === "tls";
  const transport = isTls ? https : http;

  const options: http.RequestOptions & https.RequestOptions = {
    method: "GET",
    path: requestPath,
    timeout: 10000
  };

  if (environment.connectionType === "local_socket") {
    options.socketPath = environment.socketPath ?? "/var/run/docker.sock";
  } else {
    options.host = environment.host ?? "127.0.0.1";
    options.port = environment.port ?? 2375;
  }

  if (isTls) {
    options.ca = environment.tlsCaPem ?? undefined;
    options.cert = environment.tlsCertPem ?? undefined;
    options.key = environment.tlsKeyPem ?? undefined;
    options.rejectUnauthorized = Boolean(environment.tlsCaPem);
  }

  return new Promise<T>((resolve, reject) => {
    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(body || `Docker API error ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body) as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Docker API request timed out")));
    req.end();
  });
}

function splitPortKey(value: string) {
  const [portValue, protocolValue] = value.split("/");
  return {
    port: Number(portValue),
    protocol: (protocolValue === "udp" ? "udp" : "tcp") as "tcp" | "udp"
  };
}

function normalizeContainerName(value: string) {
  return value.replace(/^\//, "");
}

function buildStatus(state: DockerInspectContainer["State"]) {
  if (state.Running) {
    return `running (pid ${state.Pid})`;
  }
  if (state.Paused) {
    return "paused";
  }
  if (state.Restarting) {
    return "restarting";
  }
  if (state.Dead) {
    return "dead";
  }
  return state.Status;
}
