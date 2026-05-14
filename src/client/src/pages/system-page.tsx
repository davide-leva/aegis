import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Ban,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Globe,
  Info,
  Network,
  RefreshCcw,
  Save,
  ServerCog,
  ShieldCheck,
  Split,
  XCircle,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { formatEventPayload, humanizeEvent, eventSeverity, type EventSeverity } from "@/lib/event-format";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MetricCard } from "@/components/ui/metric-card";
import { SimpleTable } from "@/components/ui/simple-table";

// ─── Types ────────────────────────────────────────────────────────────────────

type NetworkInterfaceConfig = {
  id?: number;
  name: string;
  address: string;
  family: "ipv4" | "ipv6";
  enabled: boolean;
  isDefault: boolean;
};

type NetworkInterfacesState = {
  availableInterfaces: NetworkInterfaceConfig[];
  interfaces: NetworkInterfaceConfig[];
};

type DnsRuntimeStatus = {
  state: "starting" | "running" | "idle" | "error" | "stopped";
  pid: number | null;
  restarts: number;
  lastStartedAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  listening: { udpPort: number | null; tcpPort: number | null; address: string | null };
};

type DnsRuntimeMetrics = {
  totalQueries: number;
  authoritativeQueries: number;
  upstreamQueries: number;
  cachedQueries: number;
  blockedQueries: number;
  nxDomainQueries: number;
  servfailQueries: number;
  avgDurationMs: number;
  lastQueryAt: string | null;
  cacheSize: number;
  cacheHits: number;
  cacheMisses: number;
};

type DnsRuntimeLog = {
  id: number;
  protocol: "udp" | "tcp";
  clientIp: string | null;
  questionName: string;
  questionType: string;
  resolutionMode: string;
  responseCode: string;
  durationMs: number;
  createdAt: string;
};

type ProxyRuntimeStatus = {
  state: "starting" | "running" | "idle" | "error" | "stopped";
  pid: number | null;
  restarts: number;
  lastStartedAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  listeners: Array<{ protocol: "http" | "https" | "tcp" | "udp"; address: string; port: number; routeCount: number }>;
};

type ProxyRuntimeMetrics = {
  totalRequests: number;
  httpRequests: number;
  httpsRequests: number;
  tcpSessions: number;
  udpPackets: number;
  errors: number;
  avgDurationMs: number;
  lastActivityAt: string | null;
};

type ProxyLog = {
  id: number;
  routeId: number | null;
  routeName: string | null;
  protocol: "http" | "https" | "tcp" | "udp";
  clientIp: string | null;
  targetHost: string | null;
  targetPort: number | null;
  outcome: "proxied" | "rejected" | "error";
  durationMs: number;
  createdAt: string;
};

type EventItem = {
  id: number;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: string;
  createdAt: string;
};

type DockerDashboard = {
  summary: { environments: number; enabledEnvironments: number; mappings: number };
  environments: Array<{ id: number; name: string; enabled: boolean }>;
  environmentStats: Array<{ environmentId: number; running: number; restarting: number; stopped: number; error: string | null }>;
};

// ─── Tabs config ──────────────────────────────────────────────────────────────

const systemTabs = [
  { value: "status", label: "Status" },
  { value: "interfaces", label: "Interfaces" },
  { value: "dns", label: "DNS Runtime" },
  { value: "proxy", label: "Proxy Runtime" },
  { value: "events", label: "Events" }
];

const PAGE_SIZE = 50;

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SystemPage() {
  const [activeTab, setActiveTab] = useState("status");
  const [eventsPage, setEventsPage] = useState(0);
  const [eventsTopicFilter, setEventsTopicFilter] = useState("");
  const [eventsTopicInput, setEventsTopicInput] = useState("");
  const [eventsSeverityFilter, setEventsSeverityFilter] = useState<EventSeverity | "all">("all");
  const queryClient = useQueryClient();

  // Interfaces
  const interfacesQuery = useQuery({
    queryKey: ["system-network-interfaces"],
    queryFn: () => api<NetworkInterfacesState>("/api/network-interfaces")
  });
  const saveMutation = useMutation({
    mutationFn: (payload: NetworkInterfaceConfig[]) =>
      api("/api/network-interfaces", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-network-interfaces"] });
      queryClient.invalidateQueries({ queryKey: ["network-interfaces"] });
      queryClient.invalidateQueries({ queryKey: ["network-interfaces-bootstrap"] });
    }
  });

  // DNS runtime
  const dnsStatus = useQuery({
    queryKey: ["dns-runtime-status"],
    queryFn: () => api<DnsRuntimeStatus>("/api/dns/runtime/status")
  });
  const dnsMetrics = useQuery({
    queryKey: ["dns-runtime-metrics"],
    queryFn: () => api<DnsRuntimeMetrics>("/api/dns/runtime/metrics")
  });
  const dnsLogs = useQuery({
    queryKey: ["dns-runtime-logs"],
    queryFn: () => api<DnsRuntimeLog[]>("/api/dns/runtime/logs?limit=20")
  });
  const dnsEvents = useQuery({
    queryKey: ["dns-runtime-events"],
    queryFn: () => api<EventItem[]>("/api/dns/events?limit=20")
  });

  // Proxy runtime
  const proxyStatus = useQuery({
    queryKey: ["proxy-runtime-status"],
    queryFn: () => api<ProxyRuntimeStatus>("/api/proxy/runtime/status")
  });
  const proxyMetrics = useQuery({
    queryKey: ["proxy-runtime-metrics"],
    queryFn: () => api<ProxyRuntimeMetrics>("/api/proxy/runtime/metrics")
  });
  const proxyLogs = useQuery({
    queryKey: ["proxy-runtime-logs"],
    queryFn: () => api<ProxyLog[]>("/api/proxy/runtime/logs?limit=20")
  });
  const proxyEvents = useQuery({
    queryKey: ["proxy-runtime-events"],
    queryFn: () => api<EventItem[]>("/api/proxy/events?limit=20")
  });

  const eventsQuery = useQuery({
    queryKey: ["domain-events", eventsPage, eventsTopicFilter],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(eventsPage * PAGE_SIZE)
      });
      if (eventsTopicFilter) params.set("topic", eventsTopicFilter);
      return api<{ items: EventItem[]; total: number }>(`/api/events?${params.toString()}`);
    },
    enabled: activeTab === "events"
  });

  // Docker (for status panel)
  const dockerDashboard = useQuery({
    queryKey: ["docker-dashboard"],
    queryFn: () => api<DockerDashboard>("/api/docker/dashboard"),
    staleTime: 30_000
  });

  const refreshRuntime = () => {
    queryClient.invalidateQueries({ queryKey: ["dns-runtime-status"] });
    queryClient.invalidateQueries({ queryKey: ["dns-runtime-metrics"] });
    queryClient.invalidateQueries({ queryKey: ["dns-runtime-logs"] });
    queryClient.invalidateQueries({ queryKey: ["dns-runtime-events"] });
    queryClient.invalidateQueries({ queryKey: ["proxy-runtime-status"] });
    queryClient.invalidateQueries({ queryKey: ["proxy-runtime-metrics"] });
    queryClient.invalidateQueries({ queryKey: ["proxy-runtime-logs"] });
    queryClient.invalidateQueries({ queryKey: ["proxy-runtime-events"] });
  };

  // Interfaces local state (must be before actions which references it)
  const [interfaceItems, setInterfaceItems] = useState<NetworkInterfaceConfig[]>([]);

  useEffect(() => {
    if (!interfacesQuery.data) return;
    setInterfaceItems(buildDiscoveredInterfaceItems(interfacesQuery.data));
  }, [interfacesQuery.data]);

  const actions = (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab} tabs={systemTabs} />
      {activeTab === "interfaces" ? (
        <>
          <Button variant="secondary" onClick={() => interfacesQuery.refetch()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <InterfacesSaveButton items={interfaceItems} onSave={(items) => saveMutation.mutate(items)} loading={saveMutation.isPending} />
        </>
      ) : activeTab === "status" ? (
        <Button variant="secondary" onClick={() => { refreshRuntime(); queryClient.invalidateQueries({ queryKey: ["docker-dashboard"] }); }}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      ) : activeTab === "events" ? (
        <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ["domain-events"] })}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      ) : (
        <Button variant="secondary" onClick={refreshRuntime}>
          <RefreshCcw className="h-4 w-4" />
          Refresh runtime
        </Button>
      )}
    </>
  );

  const totalRunning = (dockerDashboard.data?.environmentStats ?? []).reduce((sum, s) => sum + s.running, 0);
  const totalStopped = (dockerDashboard.data?.environmentStats ?? []).reduce((sum, s) => sum + s.stopped, 0);

  return (
    <AppShell
      title="System"
      description="Machine configuration, network interfaces and supervised runtime health for all Aegis workers."
      actions={actions}
    >
      {activeTab === "status" ? (
        <StatusPanel
          dnsStatus={dnsStatus.data}
          dnsMetrics={dnsMetrics.data}
          proxyStatus={proxyStatus.data}
          proxyMetrics={proxyMetrics.data}
          docker={dockerDashboard.data}
          totalRunning={totalRunning}
          totalStopped={totalStopped}
          interfaces={interfacesQuery.data}
        />
      ) : null}

      {activeTab === "interfaces" ? (
        <InterfacesPanel
          items={interfaceItems}
          setItems={setInterfaceItems}
          isLoading={interfacesQuery.isLoading}
          error={saveMutation.error instanceof Error ? saveMutation.error.message : null}
        />
      ) : null}

      {activeTab === "dns" ? (
        <DnsRuntimePanel
          status={dnsStatus.data}
          metrics={dnsMetrics.data}
          logs={dnsLogs.data ?? []}
          events={(dnsEvents.data ?? []).filter((e) => e.topic.startsWith("dns.runtime."))}
        />
      ) : null}

      {activeTab === "proxy" ? (
        <ProxyRuntimePanel
          status={proxyStatus.data}
          metrics={proxyMetrics.data}
          logs={proxyLogs.data ?? []}
          events={proxyEvents.data ?? []}
        />
      ) : null}

      {activeTab === "events" ? (
        <EventsPanel
          items={eventsQuery.data?.items ?? []}
          total={eventsQuery.data?.total ?? 0}
          page={eventsPage}
          pageSize={PAGE_SIZE}
          topicInput={eventsTopicInput}
          severityFilter={eventsSeverityFilter}
          isLoading={eventsQuery.isLoading}
          onTopicInputChange={(v) => setEventsTopicInput(v)}
          onTopicSearch={(v) => { setEventsTopicFilter(v); setEventsPage(0); }}
          onSeverityChange={(v) => { setEventsSeverityFilter(v); setEventsPage(0); }}
          onPageChange={setEventsPage}
        />
      ) : null}
    </AppShell>
  );
}

function buildDiscoveredInterfaceItems(state: NetworkInterfacesState): NetworkInterfaceConfig[] {
  const configuredByKey = new Map(
    state.interfaces.map((entry) => [interfaceConfigKey(entry), entry] as const)
  );

  const discovered = state.availableInterfaces.map((entry, index) => {
    const configured = configuredByKey.get(interfaceConfigKey(entry));
    return {
      ...entry,
      enabled: configured?.enabled ?? index === 0,
      isDefault: configured?.isDefault ?? false
    };
  });

  if (discovered.length === 0) {
    return [];
  }

  const hasEnabled = discovered.some((entry) => entry.enabled);
  const normalizedEnabled = hasEnabled
    ? discovered
    : discovered.map((entry, index) => ({
        ...entry,
        enabled: index === 0
      }));

  const defaultIndex = normalizedEnabled.findIndex((entry) => entry.enabled && entry.isDefault);
  if (defaultIndex >= 0) {
    return normalizedEnabled.map((entry, index) => ({
      ...entry,
      isDefault: entry.enabled && index === defaultIndex
    }));
  }

  const firstEnabledIndex = normalizedEnabled.findIndex((entry) => entry.enabled);
  return normalizedEnabled.map((entry, index) => ({
    ...entry,
    isDefault: entry.enabled && index === firstEnabledIndex
  }));
}

function interfaceConfigKey(entry: Pick<NetworkInterfaceConfig, "name" | "address" | "family">) {
  return `${entry.name}:${entry.address}:${entry.family}`;
}

// ─── Status panel ─────────────────────────────────────────────────────────────

function StatusPanel({
  dnsStatus,
  dnsMetrics,
  proxyStatus,
  proxyMetrics,
  docker,
  totalRunning,
  totalStopped,
  interfaces
}: {
  dnsStatus?: DnsRuntimeStatus;
  dnsMetrics?: DnsRuntimeMetrics;
  proxyStatus?: ProxyRuntimeStatus;
  proxyMetrics?: ProxyRuntimeMetrics;
  docker?: DockerDashboard;
  totalRunning: number;
  totalStopped: number;
  interfaces?: NetworkInterfacesState;
}) {
  const defaultIface = interfaces?.interfaces.find((i) => i.isDefault) ?? interfaces?.interfaces[0];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
        <ComponentCard
          icon={Globe}
          title="DNS Worker"
          state={dnsStatus?.state ?? "stopped"}
          metrics={[
            { label: "Listen", value: dnsStatus?.listening.address && dnsStatus?.listening.udpPort ? `${dnsStatus.listening.address}:${dnsStatus.listening.udpPort}` : "not bound" },
            { label: "Queries", value: (dnsMetrics?.totalQueries ?? 0).toLocaleString() },
            { label: "Blocked", value: (dnsMetrics?.blockedQueries ?? 0).toLocaleString() },
            { label: "PID", value: dnsStatus?.pid ? String(dnsStatus.pid) : "n/a" },
            { label: "Restarts", value: String(dnsStatus?.restarts ?? 0) },
            { label: "Heartbeat", value: formatTimestamp(dnsStatus?.lastHeartbeatAt) }
          ]}
          errorMessage={dnsStatus?.state === "error" ? dnsStatus.lastError : null}
          hint="DNS Runtime tab for live query log"
        />

        <ComponentCard
          icon={ShieldCheck}
          title="Proxy Worker"
          state={proxyStatus?.state ?? "stopped"}
          metrics={[
            { label: "Listeners", value: String(proxyStatus?.listeners.length ?? 0) },
            { label: "Requests", value: (proxyMetrics?.totalRequests ?? 0).toLocaleString() },
            { label: "Errors", value: (proxyMetrics?.errors ?? 0).toLocaleString() },
            { label: "Avg latency", value: proxyMetrics ? `${proxyMetrics.avgDurationMs.toFixed(1)} ms` : "n/a" },
            { label: "PID", value: proxyStatus?.pid ? String(proxyStatus.pid) : "n/a" },
            { label: "Restarts", value: String(proxyStatus?.restarts ?? 0) }
          ]}
          errorMessage={proxyStatus?.state === "error" ? proxyStatus.lastError : null}
          hint="Proxy Runtime tab for traffic log"
        />

        <ComponentCard
          icon={Boxes}
          title="Docker Discovery"
          state={docker ? (docker.summary.enabledEnvironments > 0 ? "running" : "idle") : "stopped"}
          metrics={[
            { label: "Environments", value: `${docker?.summary.enabledEnvironments ?? 0} / ${docker?.summary.environments ?? 0} enabled` },
            { label: "Running", value: String(totalRunning) },
            { label: "Stopped", value: String(totalStopped) },
            { label: "Mappings", value: String(docker?.summary.mappings ?? 0) }
          ]}
          hint="Docker Discovery for container detail"
        />

        <ComponentCard
          icon={Network}
          title="Network"
          state={interfaces && interfaces.interfaces.length > 0 ? "running" : "stopped"}
          metrics={[
            { label: "Configured", value: `${interfaces?.interfaces.length ?? 0} interfaces` },
            { label: "Default", value: defaultIface ? defaultIface.name : "not set" },
            { label: "Address", value: defaultIface ? defaultIface.address : "n/a" },
            { label: "Family", value: defaultIface ? defaultIface.family.toUpperCase() : "n/a" }
          ]}
          hint="Interfaces tab to manage"
        />
      </div>

      {/* Listener overview */}
      {(proxyStatus?.listeners.length ?? 0) > 0 && (
        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>Active proxy listeners</CardTitle>
            <CardDescription>Currently bound listener groups reported by the proxy worker.</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleTable
              headers={["Protocol", "Address", "Port", "Routes"]}
              rows={(proxyStatus?.listeners ?? []).map((l) => [
                <Badge key="p" variant={protocolVariant(l.protocol)}>{l.protocol.toUpperCase()}</Badge>,
                <span key="a" className="font-mono text-xs">{l.address}</span>,
                <span key="port" className="font-mono text-xs">{l.port}</span>,
                String(l.routeCount)
              ])}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ComponentCard({
  icon: Icon,
  title,
  state,
  metrics,
  errorMessage,
  hint
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  state: string;
  metrics: Array<{ label: string; value: string }>;
  errorMessage?: string | null;
  hint?: string;
}) {
  const { variant, bg, border } = stateStyle(state);

  return (
    <Card className={cn("relative overflow-hidden bg-background/20 transition-colors", border)}>
      <div className={cn("absolute inset-x-0 top-0 h-0.5", bg)} />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="rounded-md border border-primary/20 bg-primary/10 p-2">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <Badge variant={variant} dot>{state}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {metrics.map((m) => (
            <div key={m.label}>
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{m.label}</p>
              <p className="text-sm font-medium text-foreground tabular-nums">{m.value}</p>
            </div>
          ))}
        </div>
        {errorMessage && (
          <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {errorMessage}
          </p>
        )}
        {hint && <p className="text-[10px] text-muted-foreground/50">{hint}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Interfaces panel ─────────────────────────────────────────────────────────

function InterfacesPanel({
  items,
  setItems,
  isLoading,
  error
}: {
  items: NetworkInterfaceConfig[];
  setItems: React.Dispatch<React.SetStateAction<NetworkInterfaceConfig[]>>;
  isLoading: boolean;
  error: string | null;
}) {
  return (
    <Card className="bg-background/20">
      <CardHeader>
        <CardTitle>Network interfaces</CardTitle>
        <CardDescription>Set display names, choose which interfaces are active, and mark the default used by automapping.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((entry, index) => (
          <div key={`${entry.address}-${index}`} className="grid gap-3 rounded-md border border-border/70 p-4 md:grid-cols-[1.2fr_1.2fr_1fr_auto_auto] md:items-center">
            <div>
              <Label className="mb-2 block text-xs text-muted-foreground">Name</Label>
              <Input
                value={entry.name}
                onChange={(event) =>
                  setItems((current) => current.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))
                }
              />
            </div>
            <div>
              <Label className="mb-2 block text-xs text-muted-foreground">Address</Label>
              <p className="text-sm">{entry.address}</p>
              <p className="text-xs text-muted-foreground">{entry.family.toUpperCase()}</p>
            </div>
            <div className="text-xs text-muted-foreground">{entry.isDefault ? "Default interface" : "Available interface"}</div>
            <div className="flex items-center gap-2">
              <Switch
                checked={entry.enabled}
                onCheckedChange={(value) =>
                  setItems((current) =>
                    current.map((item, i) => (i === index ? { ...item, enabled: value, isDefault: value ? item.isDefault : false } : item))
                  )
                }
              />
              <span className="text-sm">Enabled</span>
            </div>
            <Button
              type="button"
              variant={entry.isDefault ? "default" : "secondary"}
              onClick={() => setItems((current) => current.map((item, i) => ({ ...item, isDefault: i === index })))}
            >
              Default
            </Button>
          </div>
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {isLoading && <p className="text-sm text-muted-foreground">Loading interfaces...</p>}
        {!isLoading && items.length === 0 && (
          <div className="rounded-md border border-dashed border-border bg-background/30 p-8 text-sm text-muted-foreground">
            <div className="mb-2 inline-flex rounded-md border border-primary/20 bg-primary/10 p-2">
              <Cpu className="h-4 w-4 text-primary" />
            </div>
            <p>No interfaces discovered.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Extracted button for save so we can call it from actions safely
function InterfacesSaveButton({
  items,
  onSave,
  loading
}: {
  items: NetworkInterfaceConfig[];
  onSave: (items: NetworkInterfaceConfig[]) => void;
  loading: boolean;
}) {
  return (
    <Button onClick={() => onSave(items)} disabled={loading || items.length === 0}>
      <Save className="h-4 w-4" />
      Save interfaces
    </Button>
  );
}

// ─── DNS Runtime panel ────────────────────────────────────────────────────────

function DnsRuntimePanel({
  status,
  metrics,
  logs,
  events
}: {
  status?: DnsRuntimeStatus;
  metrics?: DnsRuntimeMetrics;
  logs: DnsRuntimeLog[];
  events: EventItem[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        <MetricCard icon={Activity} label="Runtime state" valueLabel={status?.state ?? "–"} detail={status?.listening.udpPort ? `udp :${status.listening.udpPort}` : "not bound"} />
        <MetricCard icon={ServerCog} label="Total queries" value={metrics?.totalQueries ?? 0} detail={`${metrics?.authoritativeQueries ?? 0} authoritative`} />
        <MetricCard icon={Network} label="Upstream queries" value={metrics?.upstreamQueries ?? 0} detail={`${metrics?.avgDurationMs?.toFixed(1) ?? "0.0"} ms avg`} />
        <MetricCard icon={Ban} label="Denied" value={metrics?.blockedQueries ?? 0} detail={`${metrics?.servfailQueries ?? 0} servfail`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <MetricCard icon={Cpu} label="Cache entries" value={metrics?.cacheSize ?? 0} detail={`${metrics?.cachedQueries ?? 0} served from cache`} />
        <MetricCard icon={RefreshCcw} label="Cache hits" value={metrics?.cacheHits ?? 0} detail={metrics ? `${metrics.cacheHits + metrics.cacheMisses > 0 ? ((metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses)) * 100).toFixed(1) : "0.0"}% hit rate` : "n/a"} />
        <MetricCard icon={Globe} label="Cache misses" value={metrics?.cacheMisses ?? 0} detail="upstream lookups required" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>Worker status</CardTitle>
            <CardDescription>Supervision state, bind address and heartbeat for the DNS worker process.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <StatusRow label="State" value={status?.state ?? "–"} stateBadge />
            <StatusRow label="PID" value={status?.pid == null ? "n/a" : String(status.pid)} />
            <StatusRow label="Restarts" value={String(status?.restarts ?? 0)} />
            <StatusRow label="Address" value={status?.listening.address ?? "n/a"} />
            <StatusRow label="UDP port" value={status?.listening.udpPort == null ? "n/a" : String(status.listening.udpPort)} />
            <StatusRow label="Last heartbeat" value={formatTimestamp(status?.lastHeartbeatAt)} />
            <StatusRow label="Last start" value={formatTimestamp(status?.lastStartedAt)} />
            <StatusRow label="Last error" value={status?.lastError ?? "none"} />
          </CardContent>
        </Card>

        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>Recent runtime events</CardTitle>
            <CardDescription>Restart, bind and error lifecycle from the DNS worker supervisor.</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleTable
              headers={["Time", "Topic", "Payload"]}
              rows={events.slice(0, 8).map((e) => [formatTimestamp(e.createdAt), e.topic, compactJson(e.payload)])}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-background/20">
        <CardHeader>
          <CardTitle>Live query log</CardTitle>
          <CardDescription>Recent DNS requests captured by the worker.</CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleTable
            headers={["Time", "Name", "Type", "Mode", "Code", "Client", "Latency"]}
            rows={logs.map((l) => [
              formatTimestamp(l.createdAt),
              l.questionName,
              l.questionType,
              l.resolutionMode,
              l.responseCode,
              l.clientIp ?? "n/a",
              `${l.durationMs} ms`
            ])}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Proxy Runtime panel ──────────────────────────────────────────────────────

function ProxyRuntimePanel({
  status,
  metrics,
  logs,
  events
}: {
  status?: ProxyRuntimeStatus;
  metrics?: ProxyRuntimeMetrics;
  logs: ProxyLog[];
  events: EventItem[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        <MetricCard icon={Activity} label="Runtime state" valueLabel={status?.state ?? "–"} detail={`${status?.listeners.length ?? 0} listeners`} />
        <MetricCard icon={ShieldCheck} label="Total traffic" value={metrics?.totalRequests ?? 0} detail={`${metrics?.errors ?? 0} errors`} />
        <MetricCard icon={Split} label="HTTP/S" value={(metrics?.httpRequests ?? 0) + (metrics?.httpsRequests ?? 0)} detail={`${metrics?.avgDurationMs?.toFixed(1) ?? "0.0"} ms avg`} />
        <MetricCard icon={Network} label="L4 flows" value={(metrics?.tcpSessions ?? 0) + (metrics?.udpPackets ?? 0)} detail={formatTimestamp(metrics?.lastActivityAt)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>Worker status</CardTitle>
            <CardDescription>Supervision state and currently bound listeners for the proxy worker process.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <StatusRow label="State" value={status?.state ?? "–"} stateBadge />
            <StatusRow label="PID" value={status?.pid == null ? "n/a" : String(status.pid)} />
            <StatusRow label="Restarts" value={String(status?.restarts ?? 0)} />
            <StatusRow label="Last start" value={formatTimestamp(status?.lastStartedAt)} />
            <StatusRow label="Heartbeat" value={formatTimestamp(status?.lastHeartbeatAt)} />
            <StatusRow label="Last error" value={status?.lastError ?? "none"} />
          </CardContent>
        </Card>

        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>Bound listeners</CardTitle>
            <CardDescription>Active listener groups currently managed by the proxy runtime.</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleTable
              headers={["Protocol", "Address", "Port", "Routes"]}
              rows={(status?.listeners ?? []).map((l) => [
                <Badge key="p" variant={protocolVariant(l.protocol)}>{l.protocol.toUpperCase()}</Badge>,
                <span key="a" className="font-mono text-xs">{l.address}</span>,
                <span key="port" className="font-mono text-xs">{l.port}</span>,
                String(l.routeCount)
              ])}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-background/20">
        <CardHeader>
          <CardTitle>Recent runtime events</CardTitle>
          <CardDescription>Lifecycle events, restarts and listener errors from the supervised proxy worker.</CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleTable
            headers={["Time", "Topic", "Payload"]}
            rows={events.map((e) => [formatTimestamp(e.createdAt), e.topic, compactJson(e.payload)])}
          />
        </CardContent>
      </Card>

      <Card className="bg-background/20">
        <CardHeader>
          <CardTitle>Recent traffic log</CardTitle>
          <CardDescription>Observed HTTP requests, TCP sessions and UDP exchanges.</CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleTable
            headers={["Time", "Route", "Protocol", "Outcome", "Client", "Target", "Latency"]}
            rows={logs.map((l) => [
              formatTimestamp(l.createdAt),
              l.routeName ?? "Unmatched",
              l.protocol.toUpperCase(),
              l.outcome,
              l.clientIp ?? "n/a",
              l.targetHost && l.targetPort ? `${l.targetHost}:${l.targetPort}` : "n/a",
              `${l.durationMs} ms`
            ])}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function StatusRow({ label, value, stateBadge }: { label: string; value: string; stateBadge?: boolean }) {
  const stateVariant = (s: string): BadgeVariant =>
    s === "running" ? "success" : s === "error" ? "danger" : s === "starting" ? "warning" : "muted";

  return (
    <div className="rounded-md border border-border bg-secondary/25 px-3 py-3">
      <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1">
        {stateBadge ? (
          <Badge variant={stateVariant(value)} dot>{value}</Badge>
        ) : (
          <span className="text-sm">{value}</span>
        )}
      </div>
    </div>
  );
}

// ─── Events panel ─────────────────────────────────────────────────────────────

const SEVERITY_TOPICS: Record<string, string> = {
  "dns": "dns.",
  "proxy": "proxy.",
  "certificate": "certificate.",
  "acme": "acme.",
  "docker": "docker."
};

function severityBadgeVariant(severity: EventSeverity): BadgeVariant {
  if (severity === "error") return "danger";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "muted";
}

function SeverityIcon({ severity }: { severity: EventSeverity }) {
  if (severity === "error") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  if (severity === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  if (severity === "success") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  return <Info className="h-3.5 w-3.5 text-muted-foreground" />;
}

function EventsPanel({
  items,
  total,
  page,
  pageSize,
  topicInput,
  severityFilter,
  isLoading,
  onTopicInputChange,
  onTopicSearch,
  onSeverityChange,
  onPageChange
}: {
  items: EventItem[];
  total: number;
  page: number;
  pageSize: number;
  topicInput: string;
  severityFilter: EventSeverity | "all";
  isLoading: boolean;
  onTopicInputChange: (v: string) => void;
  onTopicSearch: (v: string) => void;
  onSeverityChange: (v: EventSeverity | "all") => void;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);

  const visibleItems = severityFilter === "all"
    ? items
    : items.filter((e) => eventSeverity(e.topic) === severityFilter);

  return (
    <div className="space-y-4">
      <Card className="bg-background/20">
        <CardHeader>
          <CardTitle>Domain events</CardTitle>
          <CardDescription>All system events recorded by Aegis, ordered by most recent first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-0 flex-1 gap-2">
              <Input
                placeholder="Filter by topic prefix (e.g. dns, proxy, acme)"
                value={topicInput}
                onChange={(e) => onTopicInputChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onTopicSearch(topicInput); }}
                className="max-w-sm"
              />
              <Button variant="secondary" onClick={() => onTopicSearch(topicInput)}>Search</Button>
              {topicInput && (
                <Button variant="ghost" onClick={() => { onTopicInputChange(""); onTopicSearch(""); }}>Clear</Button>
              )}
            </div>
            <Select value={severityFilter} onValueChange={(v) => onSeverityChange(v as EventSeverity | "all")}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Quick topic filters */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(SEVERITY_TOPICS).map(([label, prefix]) => (
              <Button
                key={label}
                variant="ghost"
                className="h-7 px-3 text-xs"
                onClick={() => { onTopicInputChange(label); onTopicSearch(prefix); }}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* Table */}
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading events…</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-secondary/60 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium text-xs uppercase tracking-[0.12em]">Time</th>
                    <th className="px-4 py-3 font-medium text-xs uppercase tracking-[0.12em]">Severity</th>
                    <th className="px-4 py-3 font-medium text-xs uppercase tracking-[0.12em]">Topic</th>
                    <th className="px-4 py-3 font-medium text-xs uppercase tracking-[0.12em]">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    visibleItems.map((event) => {
                      const sev = eventSeverity(event.topic);
                      return (
                        <tr key={event.id} className="border-t border-border/80">
                          <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                            {new Date(event.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <SeverityIcon severity={sev} />
                              <Badge variant={severityBadgeVariant(sev)} className="text-[10px]">{sev}</Badge>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs text-muted-foreground">{event.topic}</span>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {humanizeEvent(event.topic, event.payload)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{total.toLocaleString()} total events — page {page + 1} of {totalPages}</span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  disabled={page === 0}
                  onClick={() => onPageChange(page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  disabled={page >= totalPages - 1}
                  onClick={() => onPageChange(page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function stateStyle(state: string) {
  if (state === "running") return { variant: "success" as BadgeVariant, bg: "bg-emerald-500", border: "border-emerald-500/20" };
  if (state === "error") return { variant: "danger" as BadgeVariant, bg: "bg-red-500", border: "border-red-500/20" };
  if (state === "starting") return { variant: "warning" as BadgeVariant, bg: "bg-amber-500", border: "border-amber-500/20" };
  if (state === "idle") return { variant: "default" as BadgeVariant, bg: "bg-primary/60", border: "border-primary/20" };
  return { variant: "muted" as BadgeVariant, bg: "bg-muted-foreground/30", border: "border-border" };
}

function protocolVariant(protocol: string): BadgeVariant {
  if (protocol === "https") return "success";
  if (protocol === "http") return "default";
  if (protocol === "tcp") return "warning";
  return "muted";
}

const compactJson = formatEventPayload;
