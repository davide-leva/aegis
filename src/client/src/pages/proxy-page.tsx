import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Network, Plus, RefreshCcw, ShieldCheck, Split, Trash2, Pencil } from "lucide-react";

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

type ProxyRoute = {
  id: number;
  name: string;
  protocol: "http" | "https" | "tcp" | "udp";
  listenAddress: string;
  listenPort: number;
  sourceHost: string | null;
  sourcePath: string | null;
  targetHost: string;
  targetPort: number;
  targetProtocol: "http" | "https" | "tcp" | "udp";
  preserveHost: boolean;
  tlsCertPem: string | null;
  tlsKeyPem: string | null;
  healthStatus: "unknown" | "healthy" | "degraded";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProxyDashboard = {
  summary: {
    routes: number;
    enabledRoutes: number;
    httpListeners: number;
    tcpListeners: number;
    udpListeners: number;
  };
  routes: ProxyRoute[];
};

type ProxyRuntimeStatus = {
  state: "starting" | "running" | "idle" | "error" | "stopped";
  pid: number | null;
  restarts: number;
  lastStartedAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  listeners: Array<{
    protocol: "http" | "https" | "tcp" | "udp";
    address: string;
    port: number;
    routeCount: number;
  }>;
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
  statusCode: number | null;
  bytesIn: number;
  bytesOut: number;
  durationMs: number;
  metadata: string | null;
  createdAt: string;
};

type EventItem = {
  id: number;
  topic: string;
  payload: string;
  createdAt: string;
};

type ProxyRouteForm = {
  name: string;
  protocol: "http" | "https" | "tcp" | "udp";
  listenAddress: string;
  listenPort: number;
  sourceHost: string;
  sourcePath: string;
  targetHost: string;
  targetPort: number;
  targetProtocol: "http" | "https" | "tcp" | "udp";
  preserveHost: boolean;
  tlsCertPem: string;
  tlsKeyPem: string;
  enabled: boolean;
};

const proxyTabs = [
  { value: "routes", label: "Routes" },
  { value: "runtime", label: "Runtime" }
];

export function ProxyPage() {
  const [activeTab, setActiveTab] = useState("routes");
  const queryClient = useQueryClient();
  const refreshDashboard = () => queryClient.invalidateQueries({ queryKey: ["proxy-dashboard"] });
  const refreshRuntime = () => {
    queryClient.invalidateQueries({ queryKey: ["proxy-runtime-status"] });
    queryClient.invalidateQueries({ queryKey: ["proxy-runtime-metrics"] });
    queryClient.invalidateQueries({ queryKey: ["proxy-runtime-logs"] });
    queryClient.invalidateQueries({ queryKey: ["proxy-runtime-events"] });
  };
  const refreshAll = () => {
    refreshDashboard();
    refreshRuntime();
  };

  const dashboard = useQuery({
    queryKey: ["proxy-dashboard"],
    queryFn: () => api<ProxyDashboard>("/api/proxy/dashboard")
  });

  const runtimeStatus = useQuery({
    queryKey: ["proxy-runtime-status"],
    queryFn: () => api<ProxyRuntimeStatus>("/api/proxy/runtime/status"),
    refetchInterval: activeTab === "runtime" ? 3000 : false
  });

  const runtimeMetrics = useQuery({
    queryKey: ["proxy-runtime-metrics"],
    queryFn: () => api<ProxyRuntimeMetrics>("/api/proxy/runtime/metrics"),
    refetchInterval: activeTab === "runtime" ? 4000 : false
  });

  const runtimeLogs = useQuery({
    queryKey: ["proxy-runtime-logs"],
    queryFn: () => api<ProxyLog[]>("/api/proxy/runtime/logs?limit=20"),
    refetchInterval: activeTab === "runtime" ? 4000 : false
  });

  const runtimeEvents = useQuery({
    queryKey: ["proxy-runtime-events"],
    queryFn: () => api<EventItem[]>("/api/proxy/events?limit=20"),
    refetchInterval: activeTab === "runtime" ? 5000 : false
  });

  const createMutation = useMutation({
    mutationFn: (payload: ProxyRouteForm) =>
      api("/api/proxy/routes", { method: "POST", body: JSON.stringify(normalizeRouteForm(payload)) }),
    onSuccess: refreshAll
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ProxyRouteForm }) =>
      api(`/api/proxy/routes/${id}`, { method: "PUT", body: JSON.stringify(normalizeRouteForm(payload)) }),
    onSuccess: refreshAll
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api(`/api/proxy/routes/${id}`, { method: "DELETE" }),
    onSuccess: refreshAll
  });

  const dialogError = useMemo(() => {
    const first = [createMutation.error, updateMutation.error, deleteMutation.error].find((error) => error instanceof Error);
    return first instanceof Error ? first.message : null;
  }, [createMutation.error, updateMutation.error, deleteMutation.error]);

  if (dashboard.isLoading || !dashboard.data) {
    return (
      <AppShell title="Proxy" description="Publish HTTP, HTTPS, TCP and UDP services onto the LAN with supervised listeners.">
        <div className="rounded-lg border border-border bg-background/30 p-10 text-sm text-muted-foreground">
          Loading proxy control surface...
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Proxy"
      description="Managed publication for web and transport services, with audited changes and a supervised runtime."
      actions={
        <>
          <Tabs value={activeTab} onValueChange={setActiveTab} tabs={proxyTabs} />
          {activeTab === "runtime" ? (
            <Button variant="secondary" onClick={refreshRuntime}>
              <RefreshCcw className="h-4 w-4" />
              Refresh runtime
            </Button>
          ) : (
            <ProxyRouteDialog
              title="Add proxy route"
              description="Create a listener and map it to a LAN service."
              submitLabel="Create route"
              loading={createMutation.isPending}
              error={dialogError}
              onSubmit={(values) => createMutation.mutate(values)}
              trigger={
                <Button>
                  <Plus className="h-4 w-4" />
                  Add route
                </Button>
              }
            />
          )}
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-4">
        <MetricCard icon={ShieldCheck} label="Routes" value={dashboard.data.summary.routes} detail={`${dashboard.data.summary.enabledRoutes} enabled`} />
        <MetricCard icon={Split} label="HTTP/S listeners" value={dashboard.data.summary.httpListeners} detail="host and path aware" />
        <MetricCard icon={Network} label="TCP listeners" value={dashboard.data.summary.tcpListeners} detail="session forwarding" />
        <MetricCard icon={Activity} label="UDP listeners" value={dashboard.data.summary.udpListeners} detail="packet forwarding" />
      </div>

      {activeTab === "routes" ? (
        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>Route inventory</CardTitle>
            <CardDescription>Listener definitions and upstream targets currently active in the proxy plane.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              headers={["Name", "Listen", "Match", "Target", "State", "Actions"]}
              rows={dashboard.data.routes.map((route) => [
                route.name,
                `${route.protocol.toUpperCase()} ${route.listenAddress}:${route.listenPort}`,
                route.protocol === "http" || route.protocol === "https"
                  ? `${route.sourceHost ?? "*"}${route.sourcePath ?? "/"}`
                  : "Transport listener",
                `${route.targetProtocol}://${route.targetHost}:${route.targetPort}`,
                route.enabled ? "Enabled" : "Disabled",
                <div key={route.id} className="flex justify-end gap-2">
                  <ProxyRouteDialog
                    title="Edit proxy route"
                    description="Adjust listener mapping, target service and TLS material."
                    submitLabel="Save changes"
                    loading={updateMutation.isPending}
                    error={dialogError}
                    initialValues={routeToForm(route)}
                    onSubmit={(values) => updateMutation.mutate({ id: route.id, payload: values })}
                    trigger={
                      <Button variant="ghost" size="icon">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <DeleteDialog
                    title="Delete route"
                    description={`This will remove the listener mapping for ${route.name}.`}
                    loading={deleteMutation.isPending}
                    error={dialogError}
                    onConfirm={() => deleteMutation.mutate(route.id)}
                  />
                </div>
              ])}
            />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "runtime" ? (
        <div className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-4">
            <MetricCard icon={Activity} label="Runtime state" valueLabel={runtimeStatus.data?.state ?? "loading"} detail={`${runtimeStatus.data?.listeners.length ?? 0} listeners`} />
            <MetricCard icon={ShieldCheck} label="Total traffic" value={runtimeMetrics.data?.totalRequests ?? 0} detail={`${runtimeMetrics.data?.errors ?? 0} errors`} />
            <MetricCard icon={Split} label="HTTP/S" value={(runtimeMetrics.data?.httpRequests ?? 0) + (runtimeMetrics.data?.httpsRequests ?? 0)} detail={`${runtimeMetrics.data?.avgDurationMs?.toFixed(1) ?? "0.0"} ms avg`} />
            <MetricCard icon={Network} label="L4 flows" value={(runtimeMetrics.data?.tcpSessions ?? 0) + (runtimeMetrics.data?.udpPackets ?? 0)} detail={formatTimestamp(runtimeMetrics.data?.lastActivityAt)} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="bg-background/20">
              <CardHeader>
                <CardTitle>Runtime status</CardTitle>
                <CardDescription>Worker supervision state and currently bound listeners.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <StatusRow label="State" value={runtimeStatus.data?.state ?? "loading"} />
                <StatusRow label="PID" value={runtimeStatus.data?.pid == null ? "n/a" : String(runtimeStatus.data.pid)} />
                <StatusRow label="Restarts" value={String(runtimeStatus.data?.restarts ?? 0)} />
                <StatusRow label="Last start" value={formatTimestamp(runtimeStatus.data?.lastStartedAt)} />
                <StatusRow label="Heartbeat" value={formatTimestamp(runtimeStatus.data?.lastHeartbeatAt)} />
                <StatusRow label="Last error" value={runtimeStatus.data?.lastError ?? "none"} />
              </CardContent>
            </Card>

            <Card className="bg-background/20">
              <CardHeader>
                <CardTitle>Bound listeners</CardTitle>
                <CardDescription>Current listener groups created by the runtime.</CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  headers={["Protocol", "Address", "Port", "Routes"]}
                  rows={(runtimeStatus.data?.listeners ?? []).map((listener) => [
                    listener.protocol.toUpperCase(),
                    listener.address,
                    String(listener.port),
                    String(listener.routeCount)
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
              <DataTable
                headers={["Time", "Topic", "Payload"]}
                rows={(runtimeEvents.data ?? []).map((event) => [
                  formatTimestamp(event.createdAt),
                  event.topic,
                  compactJson(event.payload)
                ])}
              />
            </CardContent>
          </Card>

          <Card className="bg-background/20">
            <CardHeader>
              <CardTitle>Recent traffic log</CardTitle>
              <CardDescription>Observed HTTP requests, TCP sessions and UDP exchanges.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                headers={["Time", "Route", "Protocol", "Outcome", "Client", "Target", "Latency"]}
                rows={(runtimeLogs.data ?? []).map((log) => [
                  formatTimestamp(log.createdAt),
                  log.routeName ?? "Unmatched",
                  log.protocol.toUpperCase(),
                  log.outcome,
                  log.clientIp ?? "n/a",
                  log.targetHost && log.targetPort ? `${log.targetHost}:${log.targetPort}` : "n/a",
                  `${log.durationMs} ms`
                ])}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}

function ProxyRouteDialog({
  title,
  description,
  submitLabel,
  loading,
  error,
  initialValues,
  onSubmit,
  trigger
}: {
  title: string;
  description: string;
  submitLabel: string;
  loading: boolean;
  error: string | null;
  initialValues?: ProxyRouteForm;
  onSubmit: (values: ProxyRouteForm) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, watch, setValue } = useForm<ProxyRouteForm>({
    defaultValues:
      initialValues ??
      ({
        name: "",
        protocol: "http",
        listenAddress: "0.0.0.0",
        listenPort: 80,
        sourceHost: "",
        sourcePath: "/",
        targetHost: "",
        targetPort: 8080,
        targetProtocol: "http",
        preserveHost: true,
        tlsCertPem: "",
        tlsKeyPem: "",
        enabled: true
      } satisfies ProxyRouteForm)
  });

  const protocol = watch("protocol");
  const isHttpFamily = protocol === "http" || protocol === "https";
  const isHttps = protocol === "https";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={handleSubmit((values) => {
            onSubmit(values);
            setOpen(false);
          })}
        >
          <Field label="Name">
            <Input {...register("name")} />
          </Field>
          <Field label="Protocol">
            <Select
              value={protocol}
              onValueChange={(value: ProxyRouteForm["protocol"]) => {
                setValue("protocol", value);
                if (value === "https") {
                  setValue("listenPort", 443);
                  setValue("targetProtocol", "http");
                } else if (value === "http") {
                  setValue("listenPort", 80);
                  setValue("targetProtocol", "http");
                  setValue("tlsCertPem", "");
                  setValue("tlsKeyPem", "");
                } else if (value === "tcp") {
                  setValue("targetProtocol", "tcp");
                  setValue("sourceHost", "");
                  setValue("sourcePath", "");
                  setValue("tlsCertPem", "");
                  setValue("tlsKeyPem", "");
                } else {
                  setValue("targetProtocol", "udp");
                  setValue("sourceHost", "");
                  setValue("sourcePath", "");
                  setValue("tlsCertPem", "");
                  setValue("tlsKeyPem", "");
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="http">HTTP</SelectItem>
                <SelectItem value="https">HTTPS</SelectItem>
                <SelectItem value="tcp">TCP</SelectItem>
                <SelectItem value="udp">UDP</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Listen address">
            <Input {...register("listenAddress")} />
          </Field>
          <Field label="Listen port">
            <Input type="number" {...register("listenPort", { valueAsNumber: true })} />
          </Field>
          <Field label="Target host">
            <Input {...register("targetHost")} />
          </Field>
          <Field label="Target port">
            <Input type="number" {...register("targetPort", { valueAsNumber: true })} />
          </Field>
          <Field label="Target protocol">
            <Select value={watch("targetProtocol")} onValueChange={(value: ProxyRouteForm["targetProtocol"]) => setValue("targetProtocol", value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(isHttpFamily ? ["http", "https"] : [protocol]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {value.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {isHttpFamily ? (
            <>
              <Field label="Source host">
                <Input placeholder="app.azienda.local" {...register("sourceHost")} />
              </Field>
              <Field label="Source path">
                <Input placeholder="/" {...register("sourcePath")} />
              </Field>
            </>
          ) : null}
          <div className="md:col-span-2 rounded-md border border-input bg-secondary/50 px-3 py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">Preserve upstream host header</p>
                <p className="text-xs text-muted-foreground">Useful when the service expects the original virtual host.</p>
              </div>
              <Switch checked={watch("preserveHost")} onCheckedChange={(value) => setValue("preserveHost", value)} />
            </div>
          </div>
          <div className="md:col-span-2 rounded-md border border-input bg-secondary/50 px-3 py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">Enabled</p>
                <p className="text-xs text-muted-foreground">Disabled routes stay in inventory but will not bind listeners.</p>
              </div>
              <Switch checked={watch("enabled")} onCheckedChange={(value) => setValue("enabled", value)} />
            </div>
          </div>
          {isHttps ? (
            <>
              <Field label="TLS certificate PEM" className="md:col-span-2">
                <textarea
                  className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  {...register("tlsCertPem")}
                />
              </Field>
              <Field label="TLS private key PEM" className="md:col-span-2">
                <textarea
                  className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  {...register("tlsKeyPem")}
                />
              </Field>
            </>
          ) : null}
          {error ? <p className="md:col-span-2 text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="md:col-span-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={loading}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  title,
  description,
  loading,
  error,
  onConfirm
}: {
  title: string;
  description: string;
  loading: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={loading}
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            Delete route
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-2 block text-sm text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  valueLabel
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number;
  detail: string;
  valueLabel?: string;
}) {
  return (
    <Card className="bg-background/20">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{valueLabel ?? value ?? 0}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className="rounded-md border border-primary/20 bg-primary/10 p-2">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </CardContent>
    </Card>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="border-b border-border px-3 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-3 py-6 text-sm text-muted-foreground">
                No data yet.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index} className="border-b border-border/70">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-3 align-top text-foreground">
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
    <div className="rounded-md border border-border bg-background/30 px-3 py-3">
      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}

function routeToForm(route: ProxyRoute): ProxyRouteForm {
  return {
    name: route.name,
    protocol: route.protocol,
    listenAddress: route.listenAddress,
    listenPort: route.listenPort,
    sourceHost: route.sourceHost ?? "",
    sourcePath: route.sourcePath ?? "",
    targetHost: route.targetHost,
    targetPort: route.targetPort,
    targetProtocol: route.targetProtocol,
    preserveHost: route.preserveHost,
    tlsCertPem: route.tlsCertPem ?? "",
    tlsKeyPem: route.tlsKeyPem ?? "",
    enabled: route.enabled
  };
}

function normalizeRouteForm(values: ProxyRouteForm) {
  return {
    ...values,
    sourceHost: values.sourceHost.trim() || null,
    sourcePath: values.sourcePath.trim() || null,
    tlsCertPem: values.tlsCertPem.trim() || null,
    tlsKeyPem: values.tlsKeyPem.trim() || null
  };
}

function formatTimestamp(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "n/a";
}

function compactJson(payload: string) {
  try {
    return JSON.stringify(JSON.parse(payload));
  } catch {
    return payload;
  }
}
