import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Lock, Network, Plus, RefreshCcw, ShieldCheck, Split, Trash2, Pencil } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
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
import { formatEventPayload } from "@/lib/event-format";

type ProxyRoute = {
  id: number;
  name: string;
  protocol: "http" | "https" | "tcp" | "udp";
  networkInterfaceId: number | null;
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
  managedRouteIds: number[];
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
  networkInterfaceId: number | null;
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

type NetworkInterface = {
  id: number;
  name: string;
  address: string;
  family: "ipv4" | "ipv6";
  enabled: boolean;
  isDefault: boolean;
};

type CertificateAuthority = {
  id: number;
  name: string;
  subjectId: number;
  commonName: string;
  isSelfSigned: boolean;
  isDefault: boolean;
  active: boolean;
};

type ServerCertificate = {
  id: number;
  name: string;
  subjectId: number;
  caId: number;
  commonName: string;
  subjectAltNames: string[];
  certificatePem: string;
  privateKeyPem: string;
  chainPem: string;
  active: boolean;
};

type HttpsCertificateMode = "existing" | "quick" | "current";

const HTTP_LISTENER = { address: "0.0.0.0", port: 80 };
const HTTPS_LISTENER = { address: "0.0.0.0", port: 443 };

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
  const refreshCertificateInventory = () => {
    queryClient.invalidateQueries({ queryKey: ["server-certificates"] });
    queryClient.invalidateQueries({ queryKey: ["certificate-authorities"] });
    queryClient.invalidateQueries({ queryKey: ["certificates-dashboard"] });
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
  const networkInterfaces = useQuery({
    queryKey: ["network-interfaces"],
    queryFn: () => api<{ interfaces: NetworkInterface[] }>("/api/network-interfaces")
  });
  const serverCertificates = useQuery({
    queryKey: ["server-certificates"],
    queryFn: () => api<ServerCertificate[]>("/api/certificates/server-certificates")
  });
  const certificateAuthorities = useQuery({
    queryKey: ["certificate-authorities"],
    queryFn: () => api<CertificateAuthority[]>("/api/certificates/cas")
  });

  const createMutation = useMutation({
    mutationFn: (payload: ProxyRouteForm) =>
      api("/api/proxy/routes", { method: "POST", body: JSON.stringify(normalizeRouteForm(payload)) }),
    onSuccess: () => {
      refreshAll();
      refreshCertificateInventory();
    }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ProxyRouteForm }) =>
      api(`/api/proxy/routes/${id}`, { method: "PUT", body: JSON.stringify(normalizeRouteForm(payload)) }),
    onSuccess: () => {
      refreshAll();
      refreshCertificateInventory();
    }
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
              networkInterfaces={networkInterfaces.data?.interfaces ?? []}
              serverCertificates={serverCertificates.data ?? []}
              certificateAuthorities={certificateAuthorities.data ?? []}
              onSubmit={(values) => createMutation.mutateAsync(values)}
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
            <RoutesTable
              routes={dashboard.data.routes}
              managedRouteIds={dashboard.data.managedRouteIds}
              networkInterfaces={networkInterfaces.data?.interfaces ?? []}
              serverCertificates={serverCertificates.data ?? []}
              certificateAuthorities={certificateAuthorities.data ?? []}
              updateLoading={updateMutation.isPending}
              deleteLoading={deleteMutation.isPending}
              error={dialogError}
              onUpdate={(id, values) => updateMutation.mutateAsync({ id, payload: values })}
              onDelete={(id) => deleteMutation.mutate(id)}
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
                <StatusRow label="State" value={runtimeStatus.data?.state ?? "loading"} stateBadge />
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

function RoutesTable({
  routes,
  managedRouteIds,
  networkInterfaces,
  serverCertificates,
  certificateAuthorities,
  updateLoading,
  deleteLoading,
  error,
  onUpdate,
  onDelete
}: {
  routes: ProxyRoute[];
  managedRouteIds: number[];
  networkInterfaces: NetworkInterface[];
  serverCertificates: ServerCertificate[];
  certificateAuthorities: CertificateAuthority[];
  updateLoading: boolean;
  deleteLoading: boolean;
  error: string | null;
  onUpdate: (id: number, values: ProxyRouteForm) => Promise<unknown>;
  onDelete: (id: number) => void;
}) {
  const managedSet = new Set(managedRouteIds);
  const managed = routes.filter((r) => managedSet.has(r.id));
  const custom = routes.filter((r) => !managedSet.has(r.id));
  const colCount = 6;
  const headers = ["Name", "Listen", "Match", "Target", "State", ""];

  const sharedCells = (route: ProxyRoute) => [
    route.name,
    <span key="listen" className="flex items-center gap-2">
      <ProtocolBadge protocol={route.protocol} />
      <span className="font-mono text-xs text-muted-foreground">{route.listenAddress}:{route.listenPort}</span>
    </span>,
    route.protocol === "http" || route.protocol === "https"
      ? <span key="match" className="font-mono text-xs">{route.sourceHost ?? "*"}{route.sourcePath ?? "/"}</span>
      : <span key="match" className="text-muted-foreground text-xs">Transport</span>,
    <span key="target" className="font-mono text-xs">{route.targetProtocol}://{route.targetHost}:{route.targetPort}</span>,
    <Badge key="state" variant={route.enabled ? "success" : "muted"} dot>{route.enabled ? "Active" : "Disabled"}</Badge>
  ];

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          <tr>
            {headers.map((h) => (
              <th key={h} className="border-b border-border px-3 py-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-primary/10 bg-primary/5">
            <td colSpan={colCount} className="px-4 py-2">
              <div className="flex items-center gap-2.5">
                <Lock className="h-3.5 w-3.5 text-primary/60" />
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-primary/80">Managed</span>
                <Badge variant="default">{managed.length}</Badge>
                <span className="ml-1 text-xs text-muted-foreground">Auto-created by Docker automap — read-only</span>
              </div>
            </td>
          </tr>
          {managed.length === 0 ? (
            <tr className="bg-primary/[0.03]">
              <td colSpan={colCount} className="px-3 py-6 text-xs italic text-muted-foreground/60">No managed routes yet</td>
            </tr>
          ) : managed.map((route, index) => (
            <tr key={index} className="border-b border-border/70 bg-primary/[0.03]">
              {[...sharedCells(route), <span key="lock" className="flex justify-end"><span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/60"><Lock className="h-3 w-3" />Managed</span></span>].map((cell, ci) => (
                <td key={ci} className="px-3 py-3 align-top text-foreground">{cell}</td>
              ))}
            </tr>
          ))}
          <tr className="border-b border-border border-t border-border bg-secondary/30">
            <td colSpan={colCount} className="px-4 py-2">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Custom</span>
                <Badge variant="muted">{custom.length}</Badge>
                <span className="ml-1 text-xs text-muted-foreground">Manually created routes</span>
              </div>
            </td>
          </tr>
          {custom.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-3 py-6 text-xs italic text-muted-foreground/60">No custom routes yet</td>
            </tr>
          ) : custom.map((route, index) => {
            const cells = [
              ...sharedCells(route),
              <div key="actions" className="flex justify-end gap-2">
                <ProxyRouteDialog
                  title="Edit proxy route"
                  description="Adjust listener mapping, target service and TLS material."
                  submitLabel="Save changes"
                  loading={updateLoading}
                  error={error}
                  networkInterfaces={networkInterfaces}
                  serverCertificates={serverCertificates}
                  certificateAuthorities={certificateAuthorities}
                  initialValues={routeToForm(route)}
                  onSubmit={(values) => onUpdate(route.id, values)}
                  trigger={
                    <Button variant="ghost" className="h-9 w-9 p-0">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  }
                />
                <DeleteDialog
                  title="Delete route"
                  description={`This will remove the listener mapping for ${route.name}.`}
                  loading={deleteLoading}
                  error={error}
                  onConfirm={() => onDelete(route.id)}
                />
              </div>
            ];
            return (
              <tr key={index} className="border-b border-border/70">
                {cells.map((cell, ci) => (
                  <td key={ci} className="px-3 py-3 align-top text-foreground">{cell}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProxyRouteDialog({
  title,
  description,
  submitLabel,
  loading,
  error,
  networkInterfaces,
  serverCertificates,
  certificateAuthorities,
  initialValues,
  onSubmit,
  trigger
}: {
  title: string;
  description: string;
  submitLabel: string;
  loading: boolean;
  error: string | null;
  networkInterfaces: NetworkInterface[];
  serverCertificates: ServerCertificate[];
  certificateAuthorities: CertificateAuthority[];
  initialValues?: ProxyRouteForm;
  onSubmit: (values: ProxyRouteForm) => Promise<unknown>;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setValue } = useForm<ProxyRouteForm>({
    defaultValues:
      initialValues ??
      ({
        name: "",
        protocol: "http",
        networkInterfaceId: null,
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
  const hasCurrentTlsMaterial = Boolean(initialValues?.tlsCertPem && initialValues?.tlsKeyPem);
  const matchingCurrentCertificate = hasCurrentTlsMaterial
    ? serverCertificates.find(
        (certificate) =>
          certificate.certificatePem === initialValues?.tlsCertPem && certificate.privateKeyPem === initialValues?.tlsKeyPem
      ) ?? null
    : null;
  const defaultHttpsMode: HttpsCertificateMode = matchingCurrentCertificate
    ? "existing"
    : hasCurrentTlsMaterial
      ? "current"
      : "existing";
  const [httpsCertificateMode, setHttpsCertificateMode] = useState<HttpsCertificateMode>(defaultHttpsMode);
  const [selectedServerCertificateId, setSelectedServerCertificateId] = useState<string>(
    matchingCurrentCertificate ? String(matchingCurrentCertificate.id) : ""
  );
  const activeCertificateAuthorities = certificateAuthorities.filter((authority) => authority.active);
  const quickIssueAuthorities = activeCertificateAuthorities.filter((authority) => authority.isSelfSigned);
  const quickIssueAuthorityOptions = quickIssueAuthorities.length > 0 ? quickIssueAuthorities : activeCertificateAuthorities;
  const defaultQuickCa =
    quickIssueAuthorityOptions.find((authority) => authority.isDefault) ?? quickIssueAuthorityOptions[0] ?? null;
  const [quickIssueCaId, setQuickIssueCaId] = useState<string>(defaultQuickCa ? String(defaultQuickCa.id) : "");

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setLocalError(null);
          setHttpsCertificateMode(defaultHttpsMode);
          setSelectedServerCertificateId(matchingCurrentCertificate ? String(matchingCurrentCertificate.id) : "");
          setQuickIssueCaId(defaultQuickCa ? String(defaultQuickCa.id) : "");
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={handleSubmit(async (values) => {
            try {
              setLocalError(null);
              const nextValues = await buildRoutePayloadFromDialog(values, {
                httpsCertificateMode,
                selectedServerCertificateId,
                serverCertificates,
                quickIssueCaId,
                certificateAuthorities: quickIssueAuthorityOptions
              });
              await onSubmit(nextValues);
              setOpen(false);
            } catch (submitError) {
              setLocalError(submitError instanceof Error ? submitError.message : "Unable to save route");
            }
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
                  setValue("listenAddress", HTTPS_LISTENER.address);
                  setValue("listenPort", HTTPS_LISTENER.port);
                  setValue("targetProtocol", "http");
                  setHttpsCertificateMode(defaultHttpsMode);
                } else if (value === "http") {
                  setValue("listenAddress", HTTP_LISTENER.address);
                  setValue("listenPort", HTTP_LISTENER.port);
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
          <Field label="Interface">
            <Select
              value={watch("networkInterfaceId") == null ? "" : String(watch("networkInterfaceId"))}
              onValueChange={(value) => setValue("networkInterfaceId", Number(value))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select interface" />
              </SelectTrigger>
              <SelectContent>
                {networkInterfaces.filter((entry) => entry.enabled).map((entry) => (
                  <SelectItem key={entry.id} value={String(entry.id)}>
                    {entry.name} · {entry.address}{entry.isDefault ? " · default" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {isHttpFamily ? (
            <>
              <input type="hidden" {...register("listenAddress")} />
              <input type="hidden" {...register("listenPort", { valueAsNumber: true })} />
            </>
          ) : (
            <>
              <Field label="Listen address">
                <Input {...register("listenAddress")} />
              </Field>
              <Field label="Listen port">
                <Input type="number" {...register("listenPort", { valueAsNumber: true })} />
              </Field>
            </>
          )}
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
              <input type="hidden" {...register("tlsCertPem")} />
              <input type="hidden" {...register("tlsKeyPem")} />
              <Field label="TLS certificate source" className="md:col-span-2">
                <Tabs
                  value={httpsCertificateMode}
                  onValueChange={(value) => setHttpsCertificateMode(value as HttpsCertificateMode)}
                  tabs={[
                    { value: "existing", label: "Existing cert" },
                    { value: "quick", label: "Quick issue" },
                    ...(hasCurrentTlsMaterial && !matchingCurrentCertificate ? [{ value: "current", label: "Keep current" }] : [])
                  ]}
                />
              </Field>
              {httpsCertificateMode === "existing" ? (
                <Field label="Server certificate" className="md:col-span-2">
                  <Select value={selectedServerCertificateId} onValueChange={setSelectedServerCertificateId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a server certificate" />
                    </SelectTrigger>
                    <SelectContent>
                      {serverCertificates
                        .filter((certificate) => certificate.active || certificate.id === matchingCurrentCertificate?.id)
                        .map((certificate) => (
                        <SelectItem key={certificate.id} value={String(certificate.id)}>
                          {certificate.name} · {certificate.commonName}
                          {certificate.subjectAltNames.length > 0 ? ` · ${certificate.subjectAltNames.join(", ")}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              {httpsCertificateMode === "quick" ? (
                <>
                  <Field label="Root certificate authority">
                    <Select value={quickIssueCaId} onValueChange={setQuickIssueCaId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a root CA" />
                      </SelectTrigger>
                      <SelectContent>
                        {quickIssueAuthorityOptions.map((authority) => (
                          <SelectItem key={authority.id} value={String(authority.id)}>
                            {authority.name} · {authority.commonName}
                            {authority.isDefault ? " · default" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="rounded-md border border-input bg-secondary/50 px-3 py-3 md:col-span-1">
                    <p className="text-sm font-medium text-foreground">Certificate issuance</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      We create a child subject and a server certificate for the selected hostname automatically.
                    </p>
                  </div>
                </>
              ) : null}
              {httpsCertificateMode === "current" ? (
                <div className="rounded-md border border-input bg-secondary/50 px-3 py-3 md:col-span-2">
                  <p className="text-sm font-medium text-foreground">Keep current certificate</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This route already has TLS material attached outside the managed certificate inventory.
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
          {localError || error ? <p className="md:col-span-2 text-sm text-destructive">{localError ?? error}</p> : null}
          <DialogFooter className="md:col-span-2 gap-2">
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

function ProtocolBadge({ protocol }: { protocol: "http" | "https" | "tcp" | "udp" }) {
  const variants: Record<string, BadgeVariant> = { http: "default", https: "success", tcp: "warning", udp: "muted" };
  return <Badge variant={variants[protocol] ?? "default"}>{protocol.toUpperCase()}</Badge>;
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
        <Button variant="ghost" className="h-9 w-9 p-0">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter className="md:col-span-2 gap-2">
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

function StatusRow({ label, value, stateBadge }: { label: string; value: string; stateBadge?: boolean }) {
  const stateVariant = (s: string): BadgeVariant =>
    s === "running" ? "success" : s === "error" ? "danger" : s === "starting" ? "warning" : "muted";

  return (
    <div className="rounded-md border border-border bg-background/30 px-3 py-3">
      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <div className="mt-1">
        {stateBadge ? (
          <Badge variant={stateVariant(value)} dot>{value}</Badge>
        ) : (
          <p className="text-sm text-foreground">{value}</p>
        )}
      </div>
    </div>
  );
}

function routeToForm(route: ProxyRoute): ProxyRouteForm {
  return {
    name: route.name,
    protocol: route.protocol,
    networkInterfaceId: route.networkInterfaceId,
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

async function buildRoutePayloadFromDialog(
  values: ProxyRouteForm,
  options: {
    httpsCertificateMode: HttpsCertificateMode;
    selectedServerCertificateId: string;
    serverCertificates: ServerCertificate[];
    quickIssueCaId: string;
    certificateAuthorities: CertificateAuthority[];
  }
) {
  if (values.protocol !== "https") {
    return { ...values, tlsCertPem: "", tlsKeyPem: "" };
  }

  if (options.httpsCertificateMode === "current") {
    return values;
  }

  if (options.httpsCertificateMode === "existing") {
    const certificate = options.serverCertificates.find((entry) => String(entry.id) === options.selectedServerCertificateId);
    if (!certificate) {
      throw new Error("Select a server certificate for this HTTPS route");
    }
    return {
      ...values,
      tlsCertPem: certificate.certificatePem,
      tlsKeyPem: certificate.privateKeyPem
    };
  }

  const hostname = values.sourceHost.trim();
  if (!hostname) {
    throw new Error("Quick issue requires a source hostname");
  }

  const issuingAuthority = options.certificateAuthorities.find((entry) => String(entry.id) === options.quickIssueCaId);
  if (!issuingAuthority) {
    throw new Error("Select a root certificate authority for quick issue");
  }

  const subjectName = buildManagedSubjectName(hostname);
  const certificateName = buildManagedCertificateName(hostname);
  const subject = await api<{ id: number }>("/api/certificates/subjects", {
    method: "POST",
    body: JSON.stringify({
      name: subjectName,
      parentSubjectId: issuingAuthority.subjectId,
      commonName: hostname,
      organization: null,
      organizationalUnit: null,
      country: null,
      state: null,
      locality: null,
      emailAddress: null
    })
  });

  const certificate = await api<ServerCertificate>("/api/certificates/server-certificates", {
    method: "POST",
    body: JSON.stringify({
      name: certificateName,
      subjectId: subject.id,
      caId: issuingAuthority.id,
      subjectAltNames: [hostname],
      validityDays: 397,
      renewalDays: 30,
      active: true
    })
  });

  return {
    ...values,
    tlsCertPem: certificate.certificatePem,
    tlsKeyPem: certificate.privateKeyPem
  };
}

function normalizeRouteForm(values: ProxyRouteForm) {
  const listener = values.protocol === "https" ? HTTPS_LISTENER : values.protocol === "http" ? HTTP_LISTENER : null;
  return {
    ...values,
    networkInterfaceId: values.networkInterfaceId,
    listenAddress: listener?.address ?? values.listenAddress.trim(),
    listenPort: listener?.port ?? values.listenPort,
    sourceHost: values.sourceHost.trim() || null,
    sourcePath: values.sourcePath.trim() || null,
    tlsCertPem: values.tlsCertPem.trim() || null,
    tlsKeyPem: values.tlsKeyPem.trim() || null
  };
}

function buildManagedSubjectName(hostname: string) {
  return `proxy-subject-${slugifyHostname(hostname)}-${Date.now().toString(36)}`;
}

function buildManagedCertificateName(hostname: string) {
  return `proxy-cert-${slugifyHostname(hostname)}-${Date.now().toString(36)}`;
}

function slugifyHostname(hostname: string) {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatTimestamp(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "n/a";
}

const compactJson = formatEventPayload;
