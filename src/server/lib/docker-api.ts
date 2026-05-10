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
  Config: {
    Image: string;
    Env: string[] | null;
    ExposedPorts?: Record<string, Record<string, never>>;
    Labels?: Record<string, string>;
  };
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
  labels: Record<string, string>;
  networkIps: string[];
  exposedPorts: Array<{
    privatePort: number;
    protocol: "tcp" | "udp";
    publishedBindings: Array<{
      hostIp: string | null;
      publicPort: number;
    }>;
  }>;
};

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
    publishedPorts,
    networkIps: Object.values(item.NetworkSettings.Networks ?? {})
      .map((network) => network.IPAddress)
      .filter(Boolean),
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
