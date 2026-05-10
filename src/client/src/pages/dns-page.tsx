import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Ban,
  Globe,
  Network,
  Pencil,
  Plus,
  RefreshCcw,
  ServerCog,
  ShieldAlert,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";

type Settings = {
  organizationName: string;
  primaryContactEmail: string;
  defaultZoneSuffix: string;
  upstreamMode: "redundant" | "strict";
  dnsListenPort: number;
  blocklistEnabled: boolean;
};

type Zone = {
  id: number;
  name: string;
  kind: "local" | "forward";
  description: string | null;
  isPrimary: boolean;
  isReverse: boolean;
  ttl: number;
  enabled: boolean;
};

type RecordItem = {
  id: number;
  zoneId: number;
  zoneName: string;
  name: string;
  type: "A" | "AAAA" | "CNAME" | "TXT" | "MX" | "SRV";
  value: string;
  ttl: number;
  priority: number | null;
  proxiedService: string | null;
  enabled: boolean;
};

type Upstream = {
  id: number;
  name: string;
  address: string;
  port: number;
  protocol: "udp" | "tcp" | "https" | "tls";
  enabled: boolean;
  priority: number;
  healthStatus: string;
};

type BlocklistEntry = {
  id: number;
  pattern: string;
  kind: "domain" | "suffix" | "regex";
  source: string | null;
  enabled: boolean;
};

type Dashboard = {
  bootstrapCompleted: boolean;
  settings: Settings | null;
  summary: {
    zones: number;
    records: number;
    upstreams: number;
    blocklistEntries: number;
    primaryZones: number;
    disabledRecords: number;
  };
  zones: Zone[];
  records: RecordItem[];
  upstreams: Upstream[];
  blocklist: BlocklistEntry[];
};

type RuntimeStatus = {
  state: "starting" | "running" | "idle" | "error" | "stopped";
  pid: number | null;
  restarts: number;
  lastStartedAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  listening: {
    udpPort: number | null;
    tcpPort: number | null;
    address: string | null;
  };
};

type RuntimeMetrics = {
  totalQueries: number;
  authoritativeQueries: number;
  upstreamQueries: number;
  blockedQueries: number;
  nxDomainQueries: number;
  servfailQueries: number;
  avgDurationMs: number;
  lastQueryAt: string | null;
};

type RuntimeLog = {
  id: number;
  protocol: "udp" | "tcp";
  clientIp: string | null;
  questionName: string;
  questionType: string;
  resolutionMode: string;
  responseCode: string;
  answerCount: number;
  durationMs: number;
  zoneName: string | null;
  upstreamName: string | null;
  createdAt: string;
};

type EventItem = {
  id: number;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: string;
  metadata: string | null;
  createdAt: string;
};

type BootstrapForm = Settings;
type ZoneForm = Omit<Zone, "id"> & { description: string };
type RecordForm = Omit<RecordItem, "id" | "zoneName"> & { proxiedService: string };
type UpstreamForm = Omit<Upstream, "id" | "healthStatus">;
type BlocklistForm = Omit<BlocklistEntry, "id"> & { source: string };

const dnsTabs = [
  { value: "zones", label: "Zones" },
  { value: "records", label: "Records" },
  { value: "upstreams", label: "Upstreams" },
  { value: "blocklist", label: "Blocklist" },
  { value: "runtime", label: "Runtime" }
];

const createLabels: Record<string, string> = {
  zones: "Add zone",
  records: "Add record",
  upstreams: "Add upstream",
  blocklist: "Add rule"
};

export function DnsPage() {
  const [activeTab, setActiveTab] = useState("zones");
  const queryClient = useQueryClient();
  const refreshDashboard = () => queryClient.invalidateQueries({ queryKey: ["dns-dashboard"] });
  const refreshRuntime = () => {
    queryClient.invalidateQueries({ queryKey: ["dns-runtime-status"] });
    queryClient.invalidateQueries({ queryKey: ["dns-runtime-metrics"] });
    queryClient.invalidateQueries({ queryKey: ["dns-runtime-logs"] });
    queryClient.invalidateQueries({ queryKey: ["dns-runtime-events"] });
  };
  const refreshAll = () => {
    refreshDashboard();
    refreshRuntime();
  };

  const { data, isLoading } = useQuery({
    queryKey: ["dns-dashboard"],
    queryFn: () => api<Dashboard>("/api/dns/dashboard")
  });

  const runtimeStatus = useQuery({
    queryKey: ["dns-runtime-status"],
    queryFn: () => api<RuntimeStatus>("/api/dns/runtime/status"),
    refetchInterval: activeTab === "runtime" ? 3000 : false,
    enabled: Boolean(data?.bootstrapCompleted)
  });

  const runtimeMetrics = useQuery({
    queryKey: ["dns-runtime-metrics"],
    queryFn: () => api<RuntimeMetrics>("/api/dns/runtime/metrics"),
    refetchInterval: activeTab === "runtime" ? 4000 : false,
    enabled: Boolean(data?.bootstrapCompleted)
  });

  const runtimeLogs = useQuery({
    queryKey: ["dns-runtime-logs"],
    queryFn: () => api<RuntimeLog[]>("/api/dns/runtime/logs?limit=20"),
    refetchInterval: activeTab === "runtime" ? 4000 : false,
    enabled: Boolean(data?.bootstrapCompleted)
  });

  const runtimeEvents = useQuery({
    queryKey: ["dns-runtime-events"],
    queryFn: () => api<EventItem[]>("/api/dns/events?limit=20"),
    refetchInterval: activeTab === "runtime" ? 5000 : false,
    enabled: Boolean(data?.bootstrapCompleted)
  });

  const bootstrapMutation = useMutation({
    mutationFn: (payload: BootstrapForm) =>
      api("/api/dns/bootstrap", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: refreshAll
  });

  const zoneCreateMutation = useMutation({
    mutationFn: (payload: ZoneForm) =>
      api("/api/dns/zones", { method: "POST", body: JSON.stringify(normalizeZoneForm(payload)) }),
    onSuccess: refreshAll
  });
  const zoneUpdateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ZoneForm }) =>
      api(`/api/dns/zones/${id}`, { method: "PUT", body: JSON.stringify(normalizeZoneForm(payload)) }),
    onSuccess: refreshAll
  });
  const zoneDeleteMutation = useMutation({
    mutationFn: (id: number) => api(`/api/dns/zones/${id}`, { method: "DELETE" }),
    onSuccess: refreshAll
  });

  const recordCreateMutation = useMutation({
    mutationFn: (payload: RecordForm) =>
      api("/api/dns/records", { method: "POST", body: JSON.stringify(normalizeRecordForm(payload)) }),
    onSuccess: refreshAll
  });
  const recordUpdateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RecordForm }) =>
      api(`/api/dns/records/${id}`, { method: "PUT", body: JSON.stringify(normalizeRecordForm(payload)) }),
    onSuccess: refreshAll
  });
  const recordDeleteMutation = useMutation({
    mutationFn: (id: number) => api(`/api/dns/records/${id}`, { method: "DELETE" }),
    onSuccess: refreshAll
  });

  const upstreamCreateMutation = useMutation({
    mutationFn: (payload: UpstreamForm) =>
      api("/api/dns/upstreams", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: refreshAll
  });
  const upstreamUpdateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpstreamForm }) =>
      api(`/api/dns/upstreams/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    onSuccess: refreshAll
  });
  const upstreamDeleteMutation = useMutation({
    mutationFn: (id: number) => api(`/api/dns/upstreams/${id}`, { method: "DELETE" }),
    onSuccess: refreshAll
  });

  const blocklistCreateMutation = useMutation({
    mutationFn: (payload: BlocklistForm) =>
      api("/api/dns/blocklist", { method: "POST", body: JSON.stringify(normalizeBlocklistForm(payload)) }),
    onSuccess: refreshAll
  });
  const blocklistUpdateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: BlocklistForm }) =>
      api(`/api/dns/blocklist/${id}`, { method: "PUT", body: JSON.stringify(normalizeBlocklistForm(payload)) }),
    onSuccess: refreshAll
  });
  const blocklistDeleteMutation = useMutation({
    mutationFn: (id: number) => api(`/api/dns/blocklist/${id}`, { method: "DELETE" }),
    onSuccess: refreshAll
  });

  const dialogError = useMemo(() => {
    const errors = [
      zoneCreateMutation.error,
      zoneUpdateMutation.error,
      zoneDeleteMutation.error,
      recordCreateMutation.error,
      recordUpdateMutation.error,
      recordDeleteMutation.error,
      upstreamCreateMutation.error,
      upstreamUpdateMutation.error,
      upstreamDeleteMutation.error,
      blocklistCreateMutation.error,
      blocklistUpdateMutation.error,
      blocklistDeleteMutation.error
    ];
    const first = errors.find((error) => error instanceof Error);
    return first instanceof Error ? first.message : null;
  }, [
    zoneCreateMutation.error,
    zoneUpdateMutation.error,
    zoneDeleteMutation.error,
    recordCreateMutation.error,
    recordUpdateMutation.error,
    recordDeleteMutation.error,
    upstreamCreateMutation.error,
    upstreamUpdateMutation.error,
    upstreamDeleteMutation.error,
    blocklistCreateMutation.error,
    blocklistUpdateMutation.error,
    blocklistDeleteMutation.error
  ]);

  const runtimeErrorEvents = (runtimeEvents.data ?? []).filter((event) => event.topic.startsWith("dns.runtime."));

  if (isLoading || !data) {
    return (
      <AppShell title="DNS" description="Authoritative zones, recursive upstreams and resolver policy for the LAN.">
        <div className="rounded-lg border border-border bg-background/30 p-10 text-sm text-muted-foreground">
          Loading DNS control surface...
        </div>
      </AppShell>
    );
  }

  return (
    <>
      <AppShell
        title="DNS"
        description="Manage authoritative local zones, resolver fallback and block policies from a dedicated operational surface."
        actions={
          <>
            <Tabs value={activeTab} onValueChange={setActiveTab} tabs={dnsTabs} />
            {activeTab === "runtime" ? (
              <Button variant="secondary" onClick={refreshRuntime}>
                <RefreshCcw className="h-4 w-4" />
                Refresh runtime
              </Button>
            ) : (
              <CreateDialog
                activeTab={activeTab}
                zones={data.zones}
                onCreateZone={(values) => zoneCreateMutation.mutate(values)}
                onCreateRecord={(values) => recordCreateMutation.mutate(values)}
                onCreateUpstream={(values) => upstreamCreateMutation.mutate(values)}
                onCreateBlocklist={(values) => blocklistCreateMutation.mutate(values)}
                loadingMap={{
                  zones: zoneCreateMutation.isPending,
                  records: recordCreateMutation.isPending,
                  upstreams: upstreamCreateMutation.isPending,
                  blocklist: blocklistCreateMutation.isPending
                }}
                error={dialogError}
              />
            )}
          </>
        }
      >
        <div className="grid gap-4 xl:grid-cols-4">
          <MetricCard icon={Globe} label="Zones" value={data.summary.zones} detail={`${data.summary.primaryZones} primary`} />
          <MetricCard icon={Network} label="Records" value={data.summary.records} detail={`${data.summary.disabledRecords} disabled`} />
          <MetricCard icon={ServerCog} label="Upstreams" value={data.summary.upstreams} detail={data.settings?.upstreamMode ?? "n/a"} />
          <MetricCard icon={Ban} label="Blocklist" value={data.summary.blocklistEntries} detail={data.settings?.blocklistEnabled ? "enforced" : "disabled"} />
        </div>

        {activeTab === "zones" ? (
          <InventoryCard title="Zones" description="Authoritative and forwarded namespaces currently managed by the resolver.">
            <ZonesTable
              zones={data.zones}
              onUpdate={(id, payload) => zoneUpdateMutation.mutate({ id, payload })}
              onDelete={(id) => zoneDeleteMutation.mutate(id)}
              loading={zoneUpdateMutation.isPending || zoneDeleteMutation.isPending}
              error={dialogError}
            />
          </InventoryCard>
        ) : null}

        {activeTab === "records" ? (
          <InventoryCard title="Records" description="Service-facing records exposed to the LAN through your managed zones.">
            <RecordsTable
              records={data.records}
              zones={data.zones}
              onUpdate={(id, payload) => recordUpdateMutation.mutate({ id, payload })}
              onDelete={(id) => recordDeleteMutation.mutate(id)}
              loading={recordUpdateMutation.isPending || recordDeleteMutation.isPending}
              error={dialogError}
            />
          </InventoryCard>
        ) : null}

        {activeTab === "upstreams" ? (
          <InventoryCard title="Upstreams" description="Recursive resolution targets used outside your local authoritative scope.">
            <UpstreamsTable
              upstreams={data.upstreams}
              onUpdate={(id, payload) => upstreamUpdateMutation.mutate({ id, payload })}
              onDelete={(id) => upstreamDeleteMutation.mutate(id)}
              loading={upstreamUpdateMutation.isPending || upstreamDeleteMutation.isPending}
              error={dialogError}
            />
          </InventoryCard>
        ) : null}

        {activeTab === "blocklist" ? (
          <InventoryCard title="Blocklist" description="Resolver-level deny rules for domains, suffixes and imported patterns.">
            <BlocklistTable
              entries={data.blocklist}
              onUpdate={(id, payload) => blocklistUpdateMutation.mutate({ id, payload })}
              onDelete={(id) => blocklistDeleteMutation.mutate(id)}
              loading={blocklistUpdateMutation.isPending || blocklistDeleteMutation.isPending}
              error={dialogError}
            />
          </InventoryCard>
        ) : null}

        {activeTab === "runtime" ? (
          <RuntimePanel
            status={runtimeStatus.data}
            metrics={runtimeMetrics.data}
            logs={runtimeLogs.data ?? []}
            events={runtimeErrorEvents}
          />
        ) : null}
      </AppShell>

      {!data.bootstrapCompleted ? (
        <BootstrapOverlay
          loading={bootstrapMutation.isPending}
          onSubmit={(values) => bootstrapMutation.mutate(values)}
          error={bootstrapMutation.error instanceof Error ? bootstrapMutation.error.message : null}
        />
      ) : null}
    </>
  );
}

function normalizeZoneForm(payload: ZoneForm) {
  return {
    ...payload,
    description: payload.description || null
  };
}

function normalizeRecordForm(payload: RecordForm) {
  return {
    ...payload,
    priority: payload.priority ?? null,
    proxiedService: payload.proxiedService || null
  };
}

function normalizeBlocklistForm(payload: BlocklistForm) {
  return {
    ...payload,
    source: payload.source || null
  };
}

function CreateDialog({
  activeTab,
  zones,
  loadingMap,
  onCreateZone,
  onCreateRecord,
  onCreateUpstream,
  onCreateBlocklist,
  error
}: {
  activeTab: string;
  zones: Zone[];
  loadingMap: Record<string, boolean>;
  onCreateZone: (values: ZoneForm) => void;
  onCreateRecord: (values: RecordForm) => void;
  onCreateUpstream: (values: UpstreamForm) => void;
  onCreateBlocklist: (values: BlocklistForm) => void;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          {createLabels[activeTab] ?? "Create"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        {activeTab === "zones" ? (
          <ZoneFormDialog
            loading={loadingMap.zones}
            error={error}
            onSubmit={(values) => {
              onCreateZone(values);
              setOpen(false);
            }}
          />
        ) : null}
        {activeTab === "records" ? (
          <RecordFormDialog
            loading={loadingMap.records}
            zones={zones}
            error={error}
            onSubmit={(values) => {
              onCreateRecord(values);
              setOpen(false);
            }}
          />
        ) : null}
        {activeTab === "upstreams" ? (
          <UpstreamFormDialog
            loading={loadingMap.upstreams}
            error={error}
            onSubmit={(values) => {
              onCreateUpstream(values);
              setOpen(false);
            }}
          />
        ) : null}
        {activeTab === "blocklist" ? (
          <BlocklistFormDialog
            loading={loadingMap.blocklist}
            error={error}
            onSubmit={(values) => {
              onCreateBlocklist(values);
              setOpen(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BootstrapOverlay({
  onSubmit,
  loading,
  error
}: {
  onSubmit: (values: BootstrapForm) => void;
  loading: boolean;
  error: string | null;
}) {
  const { register, handleSubmit, watch, setValue } = useForm<BootstrapForm>({
    defaultValues: {
      organizationName: "Aegis Corp",
      primaryContactEmail: "dns@azienda.local",
      defaultZoneSuffix: "azienda.local",
      upstreamMode: "redundant",
      dnsListenPort: 53,
      blocklistEnabled: true
    }
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,8,15,0.78)] p-6 backdrop-blur-sm">
      <Card className="w-full max-w-3xl border-primary/25 bg-card/95">
        <CardHeader>
          <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Initial Bootstrap
          </div>
          <CardTitle>Configure the DNS service before opening the console</CardTitle>
          <CardDescription>This first-run step creates the resolver profile and the initial primary local zone.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
            <Field label="Organization">
              <Input {...register("organizationName")} />
            </Field>
            <Field label="Primary contact">
              <Input type="email" {...register("primaryContactEmail")} />
            </Field>
            <Field label="Default zone suffix">
              <Input {...register("defaultZoneSuffix")} />
            </Field>
            <Field label="DNS port">
              <Input type="number" {...register("dnsListenPort", { valueAsNumber: true })} />
            </Field>
            <Field label="Upstream mode">
              <Select value={watch("upstreamMode")} onValueChange={(value: BootstrapForm["upstreamMode"]) => setValue("upstreamMode", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="redundant">Redundant</SelectItem>
                  <SelectItem value="strict">Strict chain</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Blocklist">
              <div className="flex h-10 items-center justify-between rounded-md border border-input bg-secondary/60 px-3">
                <span className="text-sm text-muted-foreground">Enable filtering</span>
                <Switch checked={watch("blocklistEnabled")} onCheckedChange={(value) => setValue("blocklistEnabled", value)} />
              </div>
            </Field>
            {error ? <p className="md:col-span-2 text-sm text-destructive">{error}</p> : null}
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={loading}>
                <ShieldAlert className="h-4 w-4" />
                Complete bootstrap
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function RuntimePanel({
  status,
  metrics,
  logs,
  events
}: {
  status?: RuntimeStatus;
  metrics?: RuntimeMetrics;
  logs: RuntimeLog[];
  events: EventItem[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        <MetricCard icon={Activity} label="Runtime state" valueLabel={status?.state ?? "loading"} detail={status?.listening.udpPort ? `udp ${status.listening.udpPort}` : "not bound"} />
        <MetricCard icon={ServerCog} label="Total queries" value={metrics?.totalQueries ?? 0} detail={`${metrics?.authoritativeQueries ?? 0} authoritative`} />
        <MetricCard icon={Network} label="Upstream traffic" value={metrics?.upstreamQueries ?? 0} detail={`${metrics?.avgDurationMs?.toFixed(1) ?? "0.0"} ms avg`} />
        <MetricCard icon={Ban} label="Denied" value={metrics?.blockedQueries ?? 0} detail={`${metrics?.servfailQueries ?? 0} servfail`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>Runtime status</CardTitle>
            <CardDescription>Worker supervision, bind state and heartbeat.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <StatusRow label="State" value={status?.state ?? "loading"} />
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
            <CardDescription>Restart, bind and error lifecycle from the DNS worker manager.</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleTable
              headers={["Time", "Topic", "Payload"]}
              rows={events.slice(0, 8).map((event) => [formatTimestamp(event.createdAt), event.topic, safeCompactJson(event.payload)])}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-background/20">
        <CardHeader>
          <CardTitle>Live query log</CardTitle>
          <CardDescription>Recent DNS requests captured by the runtime.</CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleTable
            headers={["Time", "Name", "Type", "Mode", "Code", "Client", "Latency"]}
            rows={logs.map((log) => [
              formatTimestamp(log.createdAt),
              log.questionName,
              log.questionType,
              log.resolutionMode,
              log.responseCode,
              log.clientIp ?? "n/a",
              `${log.durationMs} ms`
            ])}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ZonesTable({
  zones,
  onUpdate,
  onDelete,
  loading,
  error
}: {
  zones: Zone[];
  onUpdate: (id: number, payload: ZoneForm) => void;
  onDelete: (id: number) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <EntityTable
      headers={["Zone", "Type", "TTL", "State", "Actions"]}
      rows={zones.map((zone) => [
        zone.name,
        zone.kind,
        `${zone.ttl}s`,
        zone.enabled ? "Enabled" : "Disabled",
        <RowActions
          key={zone.id}
          editTitle="Edit zone"
          deleteTitle="Delete zone"
          deleteDescription={`This will remove ${zone.name} and all child records.`}
          loading={loading}
          error={error}
          editContent={
            <ZoneFormDialog
              loading={loading}
              error={error}
              initialValues={zoneToForm(zone)}
              submitLabel="Save changes"
              onSubmit={(values) => onUpdate(zone.id, values)}
            />
          }
          onDelete={() => onDelete(zone.id)}
        />
      ])}
    />
  );
}

function RecordsTable({
  records,
  zones,
  onUpdate,
  onDelete,
  loading,
  error
}: {
  records: RecordItem[];
  zones: Zone[];
  onUpdate: (id: number, payload: RecordForm) => void;
  onDelete: (id: number) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <EntityTable
      headers={["FQDN", "Type", "Value", "Service", "Actions"]}
      rows={records.map((record) => [
        `${record.name}.${record.zoneName}`,
        record.type,
        record.value,
        record.proxiedService ?? "Unlinked",
        <RowActions
          key={record.id}
          editTitle="Edit record"
          deleteTitle="Delete record"
          deleteDescription={`This will remove ${record.name}.${record.zoneName}.`}
          loading={loading}
          error={error}
          editContent={
            <RecordFormDialog
              loading={loading}
              zones={zones}
              error={error}
              initialValues={recordToForm(record)}
              submitLabel="Save changes"
              onSubmit={(values) => onUpdate(record.id, values)}
            />
          }
          onDelete={() => onDelete(record.id)}
        />
      ])}
    />
  );
}

function UpstreamsTable({
  upstreams,
  onUpdate,
  onDelete,
  loading,
  error
}: {
  upstreams: Upstream[];
  onUpdate: (id: number, payload: UpstreamForm) => void;
  onDelete: (id: number) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <EntityTable
      headers={["Resolver", "Endpoint", "Protocol", "Health", "Actions"]}
      rows={upstreams.map((upstream) => [
        upstream.name,
        `${upstream.address}:${upstream.port}`,
        upstream.protocol.toUpperCase(),
        upstream.healthStatus,
        <RowActions
          key={upstream.id}
          editTitle="Edit upstream"
          deleteTitle="Delete upstream"
          deleteDescription={`This will remove upstream ${upstream.name}.`}
          loading={loading}
          error={error}
          editContent={
            <UpstreamFormDialog
              loading={loading}
              error={error}
              initialValues={upstreamToForm(upstream)}
              submitLabel="Save changes"
              onSubmit={(values) => onUpdate(upstream.id, values)}
            />
          }
          onDelete={() => onDelete(upstream.id)}
        />
      ])}
    />
  );
}

function BlocklistTable({
  entries,
  onUpdate,
  onDelete,
  loading,
  error
}: {
  entries: BlocklistEntry[];
  onUpdate: (id: number, payload: BlocklistForm) => void;
  onDelete: (id: number) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <EntityTable
      headers={["Pattern", "Kind", "Source", "State", "Actions"]}
      rows={entries.map((entry) => [
        entry.pattern,
        entry.kind,
        entry.source ?? "manual",
        entry.enabled ? "Enabled" : "Disabled",
        <RowActions
          key={entry.id}
          editTitle="Edit rule"
          deleteTitle="Delete rule"
          deleteDescription={`This will remove the blocklist rule ${entry.pattern}.`}
          loading={loading}
          error={error}
          editContent={
            <BlocklistFormDialog
              loading={loading}
              error={error}
              initialValues={blocklistToForm(entry)}
              submitLabel="Save changes"
              onSubmit={(values) => onUpdate(entry.id, values)}
            />
          }
          onDelete={() => onDelete(entry.id)}
        />
      ])}
    />
  );
}

function RowActions({
  editTitle,
  deleteTitle,
  deleteDescription,
  editContent,
  onDelete,
  loading,
  error
}: {
  editTitle: string;
  deleteTitle: string;
  deleteDescription: string;
  editContent: React.ReactNode;
  onDelete: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            <Pencil className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editTitle}</DialogTitle>
            <DialogDescription>Update the selected DNS object.</DialogDescription>
          </DialogHeader>
          {editContent}
        </DialogContent>
      </Dialog>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            <Trash2 className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{deleteTitle}</DialogTitle>
            <DialogDescription>{deleteDescription}</DialogDescription>
          </DialogHeader>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="default" disabled={loading} onClick={onDelete}>
              Confirm delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  valueLabel,
  detail
}: {
  icon: typeof Globe;
  label: string;
  value?: number;
  valueLabel?: string;
  detail: string;
}) {
  return (
    <Card className="bg-background/25">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-semibold">{valueLabel ?? value ?? 0}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.12em] text-primary">{detail}</p>
        </div>
        <div className="rounded-md border border-primary/20 bg-primary/10 p-3">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </CardContent>
    </Card>
  );
}

function InventoryCard({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="bg-background/20">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ZoneFormDialog({
  onSubmit,
  loading,
  error,
  initialValues,
  submitLabel = "Save"
}: {
  onSubmit: (values: ZoneForm) => void;
  loading: boolean;
  error: string | null;
  initialValues?: ZoneForm;
  submitLabel?: string;
}) {
  const { register, handleSubmit, watch, setValue, reset } = useForm<ZoneForm>({
    defaultValues: initialValues ?? {
      name: "apps.azienda.local",
      kind: "local",
      description: "",
      ttl: 3600,
      isPrimary: true,
      isReverse: false,
      enabled: true
    }
  });

  useEffect(() => {
    if (initialValues) {
      reset(initialValues);
    }
  }, [initialValues, reset]);

  return (
    <DialogForm
      title={initialValues ? "Update zone" : "Create zone"}
      description="Add a local authoritative zone or a forwarded namespace."
      onSubmit={handleSubmit(onSubmit)}
      loading={loading}
      error={error}
      submitLabel={submitLabel}
    >
      <Field label="Zone name">
        <Input {...register("name")} />
      </Field>
      <Field label="Type">
        <Select value={watch("kind")} onValueChange={(value: ZoneForm["kind"]) => setValue("kind", value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">Local primary</SelectItem>
            <SelectItem value="forward">Forwarded zone</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Description">
        <Input {...register("description")} />
      </Field>
      <Field label="TTL">
        <Input type="number" {...register("ttl", { valueAsNumber: true })} />
      </Field>
      <ToggleRow label="Primary" checked={watch("isPrimary")} onChange={(value) => setValue("isPrimary", value)} />
      <ToggleRow label="Reverse zone" checked={watch("isReverse")} onChange={(value) => setValue("isReverse", value)} />
      <ToggleRow label="Enabled" checked={watch("enabled")} onChange={(value) => setValue("enabled", value)} />
    </DialogForm>
  );
}

function RecordFormDialog({
  onSubmit,
  loading,
  zones,
  error,
  initialValues,
  submitLabel = "Save"
}: {
  onSubmit: (values: RecordForm) => void;
  loading: boolean;
  zones: Zone[];
  error: string | null;
  initialValues?: RecordForm;
  submitLabel?: string;
}) {
  const firstZoneId = zones[0]?.id ?? 0;
  const { register, handleSubmit, watch, setValue, reset } = useForm<RecordForm>({
    defaultValues: initialValues ?? {
      zoneId: firstZoneId,
      name: "grafana",
      type: "A",
      value: "10.0.0.15",
      ttl: 300,
      priority: null,
      proxiedService: "monitoring/grafana",
      enabled: true
    }
  });

  useEffect(() => {
    if (initialValues) {
      reset(initialValues);
    }
  }, [initialValues, reset]);

  return (
    <DialogForm
      title={initialValues ? "Update record" : "Create record"}
      description="Publish an internal workload or application endpoint."
      onSubmit={handleSubmit(onSubmit)}
      loading={loading}
      error={error}
      submitLabel={submitLabel}
    >
      <Field label="Zone">
        <Select value={String(watch("zoneId"))} onValueChange={(value) => setValue("zoneId", Number(value))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {zones.map((zone) => (
              <SelectItem key={zone.id} value={String(zone.id)}>
                {zone.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Host">
        <Input {...register("name")} />
      </Field>
      <Field label="Type">
        <Select value={watch("type")} onValueChange={(value: RecordForm["type"]) => setValue("type", value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["A", "AAAA", "CNAME", "TXT", "MX", "SRV"].map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Value">
        <Input {...register("value")} />
      </Field>
      <Field label="TTL">
        <Input type="number" {...register("ttl", { valueAsNumber: true })} />
      </Field>
      <Field label="Priority">
        <Input type="number" {...register("priority", { setValueAs: (value) => (value === "" ? null : Number(value)) })} />
      </Field>
      <Field label="Mapped service">
        <Input {...register("proxiedService")} />
      </Field>
      <ToggleRow label="Enabled" checked={watch("enabled")} onChange={(value) => setValue("enabled", value)} />
    </DialogForm>
  );
}

function UpstreamFormDialog({
  onSubmit,
  loading,
  error,
  initialValues,
  submitLabel = "Save"
}: {
  onSubmit: (values: UpstreamForm) => void;
  loading: boolean;
  error: string | null;
  initialValues?: UpstreamForm;
  submitLabel?: string;
}) {
  const { register, handleSubmit, watch, setValue, reset } = useForm<UpstreamForm>({
    defaultValues: initialValues ?? {
      name: "Cloudflare",
      address: "1.1.1.1",
      port: 53,
      protocol: "udp",
      enabled: true,
      priority: 10
    }
  });

  useEffect(() => {
    if (initialValues) {
      reset(initialValues);
    }
  }, [initialValues, reset]);

  return (
    <DialogForm
      title={initialValues ? "Update upstream" : "Create upstream"}
      description="Register a recursive resolver target for internet domains."
      onSubmit={handleSubmit(onSubmit)}
      loading={loading}
      error={error}
      submitLabel={submitLabel}
    >
      <Field label="Name">
        <Input {...register("name")} />
      </Field>
      <Field label="Address">
        <Input {...register("address")} />
      </Field>
      <Field label="Port">
        <Input type="number" {...register("port", { valueAsNumber: true })} />
      </Field>
      <Field label="Protocol">
        <Select value={watch("protocol")} onValueChange={(value: UpstreamForm["protocol"]) => setValue("protocol", value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["udp", "tcp", "https", "tls"].map((protocol) => (
              <SelectItem key={protocol} value={protocol}>
                {protocol.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Priority">
        <Input type="number" {...register("priority", { valueAsNumber: true })} />
      </Field>
      <ToggleRow label="Enabled" checked={watch("enabled")} onChange={(value) => setValue("enabled", value)} />
    </DialogForm>
  );
}

function BlocklistFormDialog({
  onSubmit,
  loading,
  error,
  initialValues,
  submitLabel = "Save"
}: {
  onSubmit: (values: BlocklistForm) => void;
  loading: boolean;
  error: string | null;
  initialValues?: BlocklistForm;
  submitLabel?: string;
}) {
  const { register, handleSubmit, watch, setValue, reset } = useForm<BlocklistForm>({
    defaultValues: initialValues ?? {
      pattern: "ads.example.com",
      kind: "domain",
      source: "manual",
      enabled: true
    }
  });

  useEffect(() => {
    if (initialValues) {
      reset(initialValues);
    }
  }, [initialValues, reset]);

  return (
    <DialogForm
      title={initialValues ? "Update block rule" : "Create block rule"}
      description="Add a domain, suffix or regex deny rule."
      onSubmit={handleSubmit(onSubmit)}
      loading={loading}
      error={error}
      submitLabel={submitLabel}
    >
      <Field label="Pattern">
        <Input {...register("pattern")} />
      </Field>
      <Field label="Kind">
        <Select value={watch("kind")} onValueChange={(value: BlocklistForm["kind"]) => setValue("kind", value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="domain">Domain</SelectItem>
            <SelectItem value="suffix">Suffix</SelectItem>
            <SelectItem value="regex">Regex</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Source">
        <Input {...register("source")} />
      </Field>
      <ToggleRow label="Enabled" checked={watch("enabled")} onChange={(value) => setValue("enabled", value)} />
    </DialogForm>
  );
}

function DialogForm({
  title,
  description,
  onSubmit,
  loading,
  error,
  submitLabel,
  children
}: {
  title: string;
  description: string;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  loading: boolean;
  error: string | null;
  submitLabel: string;
  children: React.ReactNode;
}) {
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="submit" disabled={loading}>
          <Plus className="h-4 w-4" />
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-input bg-secondary/40 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function EntityTable({ headers, rows }: { headers: string[]; rows: Array<Array<React.ReactNode>> }) {
  return <SimpleTable headers={headers} rows={rows} alignLastRight />;
}

function SimpleTable({
  headers,
  rows,
  alignLastRight = false
}: {
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
  alignLastRight?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary/60 text-muted-foreground">
          <tr>
            {headers.map((header, index) => (
              <th key={header} className={`px-4 py-3 font-medium ${alignLastRight && index === headers.length - 1 ? "text-right" : ""}`}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-4 py-8 text-center text-muted-foreground">
                No data yet.
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-border/80">
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${rowIndex}-${cellIndex}`}
                    className={`px-4 py-3 align-top ${alignLastRight && cellIndex === row.length - 1 ? "text-right" : ""}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/25 px-3 py-3">
      <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "n/a";
  }
  return new Date(value).toLocaleString();
}

function safeCompactJson(value: string) {
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed);
  } catch {
    return value;
  }
}

function zoneToForm(zone: Zone): ZoneForm {
  return {
    name: zone.name,
    kind: zone.kind,
    description: zone.description ?? "",
    ttl: zone.ttl,
    isPrimary: zone.isPrimary,
    isReverse: zone.isReverse,
    enabled: zone.enabled
  };
}

function recordToForm(record: RecordItem): RecordForm {
  return {
    zoneId: record.zoneId,
    name: record.name,
    type: record.type,
    value: record.value,
    ttl: record.ttl,
    priority: record.priority,
    proxiedService: record.proxiedService ?? "",
    enabled: record.enabled
  };
}

function upstreamToForm(upstream: Upstream): UpstreamForm {
  return {
    name: upstream.name,
    address: upstream.address,
    port: upstream.port,
    protocol: upstream.protocol,
    enabled: upstream.enabled,
    priority: upstream.priority
  };
}

function blocklistToForm(entry: BlocklistEntry): BlocklistForm {
  return {
    pattern: entry.pattern,
    kind: entry.kind,
    source: entry.source ?? "",
    enabled: entry.enabled
  };
}
