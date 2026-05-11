import { parentPort, threadId } from "node:worker_threads";

import DNS from "dns2";

import { createDb } from "../db/client.js";
import { createPrivilegedPortError, hasPrivilegedPortAccess, isPrivilegedPort, normalizePrivilegedBindError } from "../lib/privileged-ports.js";
import { createRepositories } from "../repositories/index.js";
import type { BlocklistEntry, DnsRecord, DnsRuntimeStatus, DnsUpstream, DnsZone } from "../types.js";

const { Packet } = DNS;

type ResolutionMode = "authoritative" | "upstream" | "blocked" | "nxdomain" | "servfail";

type Snapshot = {
  listenPort: number;
  zones: DnsZone[];
  records: DnsRecord[];
  upstreams: DnsUpstream[];
  blocklist: BlocklistEntry[];
  compiledBlocklist: Array<{ entry: BlocklistEntry; regex?: RegExp }>;
  version: string;
};

type WorkerMessage =
  | { type: "reload" }
  | { type: "stop" };

const db = createDb();
const repositories = createRepositories(db);

let server: any = null;
let snapshot: Snapshot | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let currentPort: number | null = null;
let currentAddress = process.env.DNS_BIND_ADDRESS ?? "0.0.0.0";
let status: DnsRuntimeStatus = {
  state: "starting",
  pid: threadId,
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

function post(message: Record<string, unknown>) {
  parentPort?.postMessage(message);
}

function normalizeName(name: string) {
  return name.replace(/\.$/, "").toLowerCase();
}

function compileSnapshot(zones: DnsZone[], records: DnsRecord[], upstreams: DnsUpstream[], blocklist: BlocklistEntry[], port: number): Snapshot {
  return {
    listenPort: port,
    zones: zones.filter((zone) => zone.enabled),
    records: records.filter((record) => record.enabled),
    upstreams: upstreams.filter((upstream) => upstream.enabled).sort((a, b) => a.priority - b.priority),
    blocklist: blocklist.filter((entry) => entry.enabled),
    compiledBlocklist: blocklist
      .filter((entry) => entry.enabled)
      .map((entry) => ({
        entry,
        regex: entry.kind === "regex" ? new RegExp(entry.pattern, "i") : undefined
      })),
    version: JSON.stringify({
      port,
      zones,
      records,
      upstreams,
      blocklist
    })
  };
}

async function refreshSnapshot() {
  const settings = await repositories.resolverSettings.get();
  if (!settings) {
    snapshot = null;
    await stopServer("idle");
    updateStatus({
      state: "idle",
      lastError: null,
      listening: {
        udpPort: null,
        tcpPort: null,
        address: null
      }
    });
    return;
  }

  const [zones, records, upstreams, blocklist] = await Promise.all([
    repositories.zones.list(),
    repositories.records.list().then((items) => items.map(({ zoneName: _zoneName, ...record }) => record)),
    repositories.upstreams.list(),
    repositories.blocklist.list()
  ]);

  const nextSnapshot = compileSnapshot(zones, records, upstreams, blocklist, settings.dnsListenPort);
  if (isPrivilegedPort(nextSnapshot.listenPort) && !hasPrivilegedPortAccess()) {
    throw createPrivilegedPortError([
      { runtime: "dns", protocol: "udp", address: currentAddress, port: nextSnapshot.listenPort },
      { runtime: "dns", protocol: "tcp", address: currentAddress, port: nextSnapshot.listenPort }
    ]);
  }
  const changed = !snapshot || snapshot.version !== nextSnapshot.version;
  const portChanged = currentPort !== nextSnapshot.listenPort;
  snapshot = nextSnapshot;

  if (!server || portChanged) {
    await restartServer();
    return;
  }

  if (changed) {
    post({ type: "runtime-reloaded", port: nextSnapshot.listenPort });
  }
}

function updateStatus(patch: Partial<DnsRuntimeStatus>) {
  status = {
    ...status,
    ...patch,
    listening: {
      ...status.listening,
      ...(patch.listening ?? {})
    }
  };

  post({ type: "status", status });
}

async function stopServer(nextState: DnsRuntimeStatus["state"] = "stopped") {
  if (!server) {
    return;
  }

  const active = server;
  server = null;
  currentPort = null;
  try {
    await active.close();
  } catch {
    // ignore close errors during shutdown paths
  }

  updateStatus({
    state: nextState,
    listening: {
      udpPort: null,
      tcpPort: null,
      address: null
    }
  });
}

async function restartServer() {
  if (!snapshot) {
    await stopServer("idle");
    return;
  }

  await stopServer("starting");

  const next = DNS.createServer({
    udp: { type: "udp4" },
    tcp: true,
    handle: async (request, send, rinfo) => {
      const question = (request as any).questions?.[0] as { name: string; type: number } | undefined;
      const startedAt = Date.now();
      const remoteInfo = rinfo as { address?: string; remoteAddress?: string } | undefined;
      const protocol = remoteInfo?.address ? "udp" : "tcp";
      const clientAddress = remoteInfo?.address ?? remoteInfo?.remoteAddress ?? null;

      if (!question) {
        const response = Packet.createResponseFromRequest(request) as any;
        response.header.rcode = 2;
        send(response);
        return;
      }

      const resolved = await resolveQuestion(question.name, question.type, protocol, clientAddress);
      const response = Packet.createResponseFromRequest(request) as any;
      response.header.ra = 1;
      response.header.aa = resolved.authoritative ? 1 : 0;
      response.header.rcode = resolved.rcode;
      response.answers.push(...resolved.answers);
      if (resolved.authorities) {
        response.authorities.push(...resolved.authorities);
      }
      if (resolved.additionals) {
        response.additionals.push(...resolved.additionals);
      }
      send(response);

      await repositories.queryLogs.create({
        protocol,
        clientIp: clientAddress,
        questionName: normalizeName(question.name),
        questionType: toTypeName(question.type),
        resolutionMode: resolved.mode,
        responseCode: rcodeToLabel(resolved.rcode),
        answerCount: resolved.answers.length,
        durationMs: Date.now() - startedAt,
        zoneName: resolved.zoneName,
        upstreamName: resolved.upstreamName
      });
    }
  });

  next.on("requestError", (error) => {
    post({ type: "runtime-error", error: `invalid request: ${error.message}` });
  });

  next.on("error", (error) => {
    post({ type: "runtime-error", error: error.message });
  });

  try {
    await next.listen({
      udp: {
        port: snapshot.listenPort,
        address: currentAddress
      },
      tcp: {
        port: snapshot.listenPort,
        address: currentAddress
      }
    });
    server = next;
    currentPort = snapshot.listenPort;
    updateStatus({
      state: "running",
      lastStartedAt: new Date().toISOString(),
      lastError: null,
      listening: {
        udpPort: snapshot.listenPort,
        tcpPort: snapshot.listenPort,
        address: currentAddress
      }
    });
  } catch (error) {
    const normalized = normalizePrivilegedBindError(error, [
      { runtime: "dns", protocol: "udp", address: currentAddress, port: snapshot.listenPort },
      { runtime: "dns", protocol: "tcp", address: currentAddress, port: snapshot.listenPort }
    ]);
    const message = normalized.message;
    updateStatus({
      state: "error",
      lastError: message,
      listening: {
        udpPort: null,
        tcpPort: null,
        address: null
      }
    });
    post({ type: "runtime-error", error: message });
  }
}

function toTypeName(type: number) {
  const entry = Object.entries(Packet.TYPE).find(([, value]) => value === type);
  return entry?.[0] ?? "A";
}

function rcodeToLabel(rcode: number) {
  switch (rcode) {
    case 0:
      return "NOERROR";
    case 2:
      return "SERVFAIL";
    case 3:
      return "NXDOMAIN";
    case 5:
      return "REFUSED";
    default:
      return `RCODE_${rcode}`;
  }
}

function matchBlocklist(name: string) {
  if (!snapshot) {
    return false;
  }

  return snapshot.compiledBlocklist.some(({ entry, regex }) => {
    if (entry.kind === "domain") {
      return normalizeName(entry.pattern) === name;
    }
    if (entry.kind === "suffix") {
      const suffix = normalizeName(entry.pattern);
      return name === suffix || name.endsWith(`.${suffix}`);
    }
    return regex?.test(name) ?? false;
  });
}

function findBestZone(name: string) {
  if (!snapshot) {
    return null;
  }

  return [...snapshot.zones]
    .sort((a, b) => b.name.length - a.name.length)
    .find((zone) => name === normalizeName(zone.name) || name.endsWith(`.${normalizeName(zone.name)}`)) ?? null;
}

function zoneHostLabel(name: string, zone: DnsZone) {
  const zoneName = normalizeName(zone.name);
  if (name === zoneName) {
    return "@";
  }
  return name.slice(0, -(zoneName.length + 1));
}

function makeAuthoritativeAnswers(zone: DnsZone, qname: string, qtype: string) {
  if (!snapshot) {
    return [];
  }

  const label = zoneHostLabel(qname, zone);
  const normalizedLabel = normalizeName(label);
  const zoneRecords = snapshot.records.filter((record) => record.zoneId === zone.id);
  const candidates = zoneRecords.filter((record) => normalizeName(record.name || "@") === normalizedLabel);

  const exact = candidates.filter((record) => record.type === qtype || qtype === "ANY");
  if (exact.length > 0) {
    return exact.map((record) => toAnswer(qname, record));
  }

  if (qtype !== "CNAME") {
    const cname = candidates.find((record) => record.type === "CNAME");
    if (cname) {
      return [toAnswer(qname, cname)];
    }
  }

  return [];
}

function toAnswer(qname: string, record: DnsRecord) {
  const base = {
    name: qname,
    type: Packet.TYPE[record.type],
    class: Packet.CLASS.IN,
    ttl: record.ttl
  };

  switch (record.type) {
    case "A":
    case "AAAA":
      return {
        ...base,
        address: record.value
      };
    case "CNAME":
      return {
        ...base,
        domain: normalizeTarget(record.value)
      };
    case "TXT":
      return {
        ...base,
        data: record.value
      };
    case "MX":
      return {
        ...base,
        exchange: normalizeTarget(record.value),
        priority: record.priority ?? 10
      };
    case "SRV": {
      const [weightRaw, portRaw, targetRaw] = record.value.trim().split(/\s+/);
      return {
        ...base,
        priority: record.priority ?? 10,
        weight: Number(weightRaw ?? 0),
        port: Number(portRaw ?? 0),
        target: normalizeTarget(targetRaw ?? record.value)
      };
    }
    default:
      return {
        ...base,
        data: record.value
      };
  }
}

function normalizeTarget(value: string) {
  return value.endsWith(".") ? value : `${value}.`;
}

async function resolveQuestion(questionName: string, type: number, protocol: "udp" | "tcp", clientIp: string | null) {
  const name = normalizeName(questionName);
  const qtype = toTypeName(type);

  if (!snapshot) {
    return {
      authoritative: false,
      rcode: 2,
      answers: [],
      mode: "servfail" as ResolutionMode,
      zoneName: null,
      upstreamName: null
    };
  }

  if (matchBlocklist(name)) {
    return {
      authoritative: true,
      rcode: 3,
      answers: [],
      mode: "blocked" as ResolutionMode,
      zoneName: null,
      upstreamName: null
    };
  }

  const zone = findBestZone(name);
  if (zone?.kind === "local") {
    const answers = makeAuthoritativeAnswers(zone, name, qtype);
    if (answers.length > 0) {
      return {
        authoritative: true,
        rcode: 0,
        answers,
        mode: "authoritative" as ResolutionMode,
        zoneName: zone.name,
        upstreamName: null
      };
    }

    return {
      authoritative: true,
      rcode: 3,
      answers: [],
      mode: "nxdomain" as ResolutionMode,
      zoneName: zone.name,
      upstreamName: null
    };
  }

  for (const upstream of snapshot.upstreams) {
    try {
      const upstreamResponse = await queryUpstream(upstream, name, qtype) as any;
      return {
        authoritative: false,
        rcode: upstreamResponse.header?.rcode ?? 0,
        answers: upstreamResponse.answers ?? [],
        authorities: upstreamResponse.authorities ?? [],
        additionals: upstreamResponse.additionals ?? [],
        mode: upstreamResponse.answers?.length ? ("upstream" as ResolutionMode) : ("nxdomain" as ResolutionMode),
        zoneName: zone?.name ?? null,
        upstreamName: upstream.name
      };
    } catch {
      continue;
    }
  }

  return {
    authoritative: false,
    rcode: 2,
    answers: [],
    mode: "servfail" as ResolutionMode,
    zoneName: zone?.name ?? null,
    upstreamName: null
  };
}

async function queryUpstream(upstream: DnsUpstream, name: string, qtype: string) {
  const resolver = createResolver(upstream);
  return Promise.race([
    resolver(name, qtype as never, Packet.CLASS.IN),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("upstream timeout")), 2500);
    })
  ]);
}

function createResolver(upstream: DnsUpstream) {
  if (upstream.protocol === "udp") {
    return DNS.UDPClient({
      dns: upstream.address,
      port: upstream.port
    });
  }

  if (upstream.protocol === "tcp") {
    return DNS.TCPClient({
      dns: upstream.address,
      port: upstream.port,
      protocol: "tcp:"
    });
  }

  if (upstream.protocol === "tls") {
    return DNS.TCPClient({
      dns: upstream.address,
      port: upstream.port || 853,
      protocol: "tls:"
    });
  }

  const dns = upstream.address.startsWith("http") ? upstream.address : `https://${upstream.address}/dns-query`;
  return DNS.DOHClient({ dns });
}

async function start() {
  parentPort?.on("message", async (message: WorkerMessage) => {
    if (message.type === "reload") {
      await refreshSnapshot();
    }
    if (message.type === "stop") {
      await shutdown();
    }
  });

  refreshTimer = setInterval(() => {
    void refreshSnapshot();
  }, 5000);

  heartbeatTimer = setInterval(() => {
    updateStatus({
      lastHeartbeatAt: new Date().toISOString()
    });
  }, 3000);

  await refreshSnapshot();
}

async function shutdown() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  await stopServer("stopped");
  process.exit(0);
}

process.on("uncaughtException", (error) => {
  post({ type: "runtime-error", error: error.message });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  post({ type: "runtime-error", error: message });
  process.exit(1);
});

void start();
