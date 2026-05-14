import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Boxes, Link2, Network, Pencil, Plus, RefreshCcw, Server } from "lucide-react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DeleteDialog } from "@/components/ui/delete-dialog";
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
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MetricCard } from "@/components/ui/metric-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { formatEventPayload } from "@/lib/event-format";
import { formatTimestamp } from "@/lib/format";

const HTTP_LISTENER = { address: "0.0.0.0", port: 80 };
const HTTPS_LISTENER = { address: "0.0.0.0", port: 443 };

type DockerEnvironment = {
  id: number;
  name: string;
  connectionType: "local_socket" | "tcp" | "tls";
  socketPath: string | null;
  host: string | null;
  port: number | null;
  tlsCaPem: string | null;
  tlsCertPem: string | null;
  tlsKeyPem: string | null;
  publicIp: string;
  enabled: boolean;
};

type DockerPortMapping = {
  id: number;
  environmentId: number;
  containerId: string;
  containerName: string;
  privatePort: number;
  publicPort: number | null;
  protocol: "tcp" | "udp";
  proxyRouteId: number;
  proxyRouteName: string | null;
};

type DockerDashboard = {
  summary: {
    environments: number;
    enabledEnvironments: number;
    mappings: number;
  };
  environments: DockerEnvironment[];
  environmentStats: Array<{
    environmentId: number;
    running: number;
    restarting: number;
    stopped: number;
    error: string | null;
  }>;
  mappings: DockerPortMapping[];
};

type DockerContainerListItem = {
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
  mappings: DockerPortMapping[];
};

type DockerContainerDetail = {
  id: string;
  name: string;
  image: string;
  labels: Record<string, string>;
  state: string;
  status: string;
  createdAt: string;
  pid: number;
  restartCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  restartPolicy: string;
  memoryLimitBytes: number;
  publishedPorts: Array<{
    privatePort: number;
    publicPort: number | null;
    protocol: "tcp" | "udp";
    hostIp: string | null;
  }>;
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
  mappings: DockerPortMapping[];
  automapCandidates: Array<{
    service: string;
    dnsName: string;
    routeProtocol: "http" | "https" | "tcp" | "udp";
    privatePort: number;
    protocol: "tcp" | "udp";
    publicPort: number | null;
    routeName: string;
    networkInterfaceId: number | null;
    listenAddress: string;
    listenPort: number;
    sourcePath: string | null;
    preserveHost: boolean;
    enabled: boolean;
    alreadyMapped: boolean;
    existingRouteName: string | null;
  }>;
  automapIssues: Array<{
    service: string;
    severity: "error";
    code: string;
    message: string;
    labels: string[];
    signature: string;
  }>;
  automapEvents: Array<{
    id: number;
    topic: string;
    payload: string;
    createdAt: string;
  }>;
  environment: {
    id: number;
    name: string;
    publicIp: string;
  };
};

type EnvironmentForm = {
  name: string;
  connectionType: "local_socket" | "tcp" | "tls";
  socketPath: string;
  host: string;
  port: number | null;
  tlsCaPem: string;
  tlsCertPem: string;
  tlsKeyPem: string;
  publicIp: string;
  enabled: boolean;
};

type MappingForm = {
  dnsName: string;
  routeName: string;
  routeProtocol: "http" | "https" | "tcp" | "udp";
  networkInterfaceId: number | null;
  listenAddress: string;
  listenPort: number;
  sourcePath: string;
  preserveHost: boolean;
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

export function DockerPage() {
  return (
    <Routes>
      <Route path="/" element={<DockerWorkspace />} />
      <Route path=":environmentId" element={<DockerWorkspace />} />
      <Route path=":environmentId/:containerId" element={<DockerWorkspace />} />
    </Routes>
  );
}

function DockerWorkspace() {
  const params = useParams();
  const navigate = useNavigate();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const queryClient = useQueryClient();

  const selectedEnvironmentId = useMemo(() => {
    const fromRoute = Number(params.environmentId ?? 0);
    return Number.isFinite(fromRoute) ? fromRoute : 0;
  }, [params.environmentId]);

  const selectedContainerId = params.containerId ?? null;

  const dashboard = useQuery({
    queryKey: ["docker-dashboard"],
    queryFn: () => api<DockerDashboard>("/api/docker/dashboard")
  });

  const containers = useQuery({
    queryKey: ["docker-containers", selectedEnvironmentId, refreshNonce],
    queryFn: () => api<DockerContainerListItem[]>(`/api/docker/environments/${selectedEnvironmentId}/containers`),
    enabled: selectedEnvironmentId > 0
  });

  const containerDetail = useQuery({
    queryKey: ["docker-container-detail", selectedEnvironmentId, selectedContainerId, refreshNonce],
    queryFn: () =>
      api<DockerContainerDetail>(`/api/docker/environments/${selectedEnvironmentId}/containers/${selectedContainerId}`),
    enabled: selectedEnvironmentId > 0 && Boolean(selectedContainerId)
  });

  const networkInterfaces = useQuery({
    queryKey: ["network-interfaces"],
    queryFn: () => api<{ interfaces: NetworkInterface[] }>("/api/network-interfaces")
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["docker-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["docker-containers", selectedEnvironmentId] });
    queryClient.invalidateQueries({ queryKey: ["docker-container-detail", selectedEnvironmentId, selectedContainerId] });
    setRefreshNonce((value) => value + 1);
  };

  const createEnvironmentMutation = useMutation({
    mutationFn: (payload: EnvironmentForm) =>
      api("/api/docker/environments", { method: "POST", body: JSON.stringify(normalizeEnvironmentForm(payload)) }),
    onSuccess: refreshAll
  });

  const updateEnvironmentMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: EnvironmentForm }) =>
      api(`/api/docker/environments/${id}`, { method: "PUT", body: JSON.stringify(normalizeEnvironmentForm(payload)) }),
    onSuccess: refreshAll
  });

  const deleteEnvironmentMutation = useMutation({
    mutationFn: (id: number) => api(`/api/docker/environments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refreshAll();
      navigate("/docker");
    }
  });

  const createMappingMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api("/api/docker/mappings", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: refreshAll
  });

  const autoMapMutation = useMutation({
    mutationFn: ({ environmentId, containerId }: { environmentId: number; containerId: string }) =>
      api(`/api/docker/environments/${environmentId}/containers/${encodeURIComponent(containerId)}/automap`, {
        method: "POST"
      }),
    onSuccess: refreshAll
  });

  const dialogError = useMemo(() => {
    const errors = [
      createEnvironmentMutation.error,
      updateEnvironmentMutation.error,
      deleteEnvironmentMutation.error,
      createMappingMutation.error,
      autoMapMutation.error
    ];
    const first = errors.find((error) => error instanceof Error);
    return first instanceof Error ? first.message : null;
  }, [
    createEnvironmentMutation.error,
    updateEnvironmentMutation.error,
    deleteEnvironmentMutation.error,
    createMappingMutation.error,
    autoMapMutation.error
  ]);

  if (dashboard.isLoading || !dashboard.data) {
    return (
      <AppShell title="Docker Discovery" description="Register Docker environments and expose container ports through Aegis.">
        <div className="rounded-lg border border-border bg-background/30 p-10 text-sm text-muted-foreground">
          Loading Docker control surface...
        </div>
      </AppShell>
    );
  }

  const data = dashboard.data;
  const selectedEnvironment = data.environments.find((item) => item.id === selectedEnvironmentId) ?? null;
  const viewMode = selectedContainerId ? "container" : params.environmentId ? "containers" : "environments";
  const primaryTitle =
    viewMode === "environments" ? "Docker environments"
    : viewMode === "container" ? (containerDetail.data?.name ?? "Container")
    : "Containers";
  const primaryDescription =
    viewMode === "environments"
      ? "Socket-local and remote engines registered in Aegis, with quick container health counts."
      : viewMode === "container"
        ? containerDetail.data
          ? `${containerDetail.data.image} · started ${formatTimestamp(containerDetail.data.startedAt)}`
          : "Loading container details…"
        : selectedEnvironment
          ? `Containers discovered on ${selectedEnvironment.name}. Click a container to inspect and map its ports.`
          : "The selected environment could not be found.";
  const backTarget =
    viewMode === "container" ? `/docker/${selectedEnvironmentId}`
    : viewMode === "containers" ? "/docker"
    : null;
  const breadcrumbItems = [
    { label: "Docker", to: "/docker" },
    ...(selectedEnvironment ? [{ label: selectedEnvironment.name, to: `/docker/${selectedEnvironment.id}` }] : []),
    ...(viewMode === "container" && containerDetail.data ? [{ label: containerDetail.data.name }] : [])
  ];

  return (
    <AppShell
      title="Docker Discovery"
      description="Register local or remote Docker engines, inspect running containers and map published services into Aegis proxy routes."
      actions={
        <>
          <Button variant="secondary" onClick={refreshAll}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <EnvironmentDialog
            title="Add Docker environment"
            description="Register a local socket or remote Docker engine endpoint."
            submitLabel="Create environment"
            loading={createEnvironmentMutation.isPending}
            error={dialogError}
            onSubmit={(values) => createEnvironmentMutation.mutateAsync(values)}
            trigger={
              <Button>
                <Plus className="h-4 w-4" />
                Add environment
              </Button>
            }
          />
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-4">
        <MetricCard icon={Server} label="Environments" value={data.summary.environments} detail={`${data.summary.enabledEnvironments} enabled`} />
        <MetricCard
          icon={Boxes}
          label="Containers"
          value={containers.data?.length ?? 0}
          detail={selectedEnvironment ? selectedEnvironment.name : "choose an environment"}
        />
        <MetricCard icon={Link2} label="Mappings" value={data.summary.mappings} detail="container ports linked to proxy routes" />
        <MetricCard icon={Network} label="Public IP" valueLabel={selectedEnvironment?.publicIp ?? "n/a"} detail="used when binding published container ports" />
      </div>

      <div className="space-y-6">
        <Card className="bg-background/20">
          <CardHeader>
            <CardTopNav backTarget={backTarget} items={breadcrumbItems} />
            <CardTitle>{primaryTitle}</CardTitle>
            <CardDescription>{primaryDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* ── Level 1: environments list ── */}
            {viewMode === "environments" ? (
              <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                {data.environments.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
                    No Docker environments yet. Add one to start discovering containers.
                  </p>
                ) : (
                  data.environments.map((environment) => {
                    const stats = data.environmentStats.find((item) => item.environmentId === environment.id);
                    return (
                      <div
                        key={environment.id}
                        className="rounded-lg border border-border bg-background/30 p-4 transition-all"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/docker/${environment.id}`)}>
                            <div className="mb-3 flex flex-wrap gap-2">
                              <Badge variant={environment.enabled ? "success" : "muted"} dot>
                                {environment.enabled ? "Active" : "Disabled"}
                              </Badge>
                              <Badge variant="default">{labelConnectionType(environment)}</Badge>
                            </div>
                            <p className="text-sm font-semibold text-foreground">{environment.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{labelConnection(environment)}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Public IP: <span className="font-mono">{environment.publicIp}</span>
                            </p>
                          </button>
                          <div className="flex shrink-0 gap-1">
                            <EnvironmentDialog
                              title="Edit Docker environment"
                              description="Adjust connection and public addressing details."
                              submitLabel="Save changes"
                              loading={updateEnvironmentMutation.isPending}
                              error={dialogError}
                              initialValues={environmentToForm(environment)}
                              onSubmit={(values) => updateEnvironmentMutation.mutateAsync({ id: environment.id, payload: values })}
                              trigger={
                                <Button variant="ghost" className="h-9 w-9 p-0">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              }
                            />
                            <DeleteDialog
                              title="Delete Docker environment"
                              description={`This removes ${environment.name} and its stored mappings.`}
                              submitLabel="Delete environment"
                              loading={deleteEnvironmentMutation.isPending}
                              error={dialogError}
                              onConfirm={() => deleteEnvironmentMutation.mutate(environment.id)}
                            />
                          </div>
                        </div>

                        {environment.enabled ? (
                          <div className="mt-4 flex items-center gap-4 rounded-md border border-border bg-background/40 p-3">
                            <ContainerDonut
                              running={stats?.running ?? 0}
                              restarting={stats?.restarting ?? 0}
                              stopped={stats?.stopped ?? 0}
                            />
                            <div className="flex-1 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] text-muted-foreground">Running</span>
                                <span className={cn("text-sm font-semibold tabular-nums", (stats?.running ?? 0) > 0 ? "text-emerald-500" : "text-muted-foreground")}>
                                  {stats?.running ?? 0}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] text-muted-foreground">Restarting</span>
                                <span className={cn("text-sm font-semibold tabular-nums", (stats?.restarting ?? 0) > 0 ? "text-amber-500" : "text-muted-foreground")}>
                                  {stats?.restarting ?? 0}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] text-muted-foreground">Stopped</span>
                                <span className="text-sm font-semibold tabular-nums text-muted-foreground">{stats?.stopped ?? 0}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-4 rounded-md border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
                            Environment is disabled — enable it to discover containers.
                          </div>
                        )}

                        {stats?.error ? <p className="mt-3 text-xs text-destructive">{stats.error}</p> : null}
                        {environment.enabled && !stats?.error ? (
                          <EnvironmentResourceStatsRow environmentId={environment.id} />
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}

            {/* ── Level 2: containers grid ── */}
            {viewMode === "containers" ? (
              selectedEnvironment ? (
                <div className="space-y-4">
                  {containers.isLoading ? (
                    <p className="rounded-md border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
                      Loading containers...
                    </p>
                  ) : (containers.data ?? []).length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
                      No containers found on this environment.
                    </p>
                  ) : (
                    <>
                      <ContainerStatsBar containers={containers.data ?? []} />
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        {(containers.data ?? []).map((container) => (
                          <ContainerCard
                            key={container.id}
                            container={container}
                            onClick={() => navigate(`/docker/${selectedEnvironment.id}/${container.id}`)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
                  The selected environment no longer exists.
                </p>
              )
            ) : null}

            {/* ── Level 3: container detail ── */}
            {viewMode === "container" ? (
              containerDetail.isLoading ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Loading container details…</p>
              ) : containerDetail.data ? (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <StateBadge state={containerDetail.data.state} />
                    {containerDetail.data.pid > 0 && (
                      <span className="font-mono text-xs text-muted-foreground">PID {containerDetail.data.pid}</span>
                    )}
                    {containerDetail.data.restartCount > 0 && (
                      <Badge variant="warning">{containerDetail.data.restartCount} restart{containerDetail.data.restartCount !== 1 ? "s" : ""}</Badge>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    <MiniStat label="Mappings" value={String(containerDetail.data.mappings.length)} />
                    <MiniStat label="Public IP" value={containerDetail.data.environment.publicIp} />
                    <MiniStat label="Status" value={containerDetail.data.status} />
                    <MiniStat label="Restart policy" value={containerDetail.data.restartPolicy} />
                    <MiniStat
                      label="Memory limit"
                      value={containerDetail.data.memoryLimitBytes > 0 ? formatBytes(containerDetail.data.memoryLimitBytes) : "No limit"}
                    />
                    <MiniStat label="Networks" value={String(containerDetail.data.networks.length || containerDetail.data.networkIps.length)} />
                  </div>

                  {containerDetail.data.networks.length > 0 && (
                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Networks</h4>
                      <div className="flex flex-wrap gap-2">
                        {containerDetail.data.networks.map((net) => (
                          <div key={net.name} className="flex items-center gap-1.5 rounded border border-border bg-background/60 px-2.5 py-1.5">
                            <span className="text-[11px] font-medium text-foreground">{net.name}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">{net.ip}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {Object.keys(containerDetail.data.labels).filter((k) => k.startsWith("aegis.")).length > 0 && (
                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Aegis Labels</h4>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(containerDetail.data.labels)
                          .filter(([k]) => k.startsWith("aegis."))
                          .map(([k, v]) => (
                            <div key={k} className="rounded border border-border bg-background/60 px-2 py-1 font-mono text-[11px]">
                              <span className="text-primary">{k}</span>
                              <span className="text-muted-foreground"> = </span>
                              <span className="text-foreground">{v}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-md border border-border bg-background/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Automap labels</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Detected <code className="font-mono">aegis.*</code> labels generate DNS, proxy routes and HTTPS certificates automatically.
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={autoMapMutation.isPending || containerDetail.data.automapCandidates.filter((c) => !c.alreadyMapped).length === 0}
                        onClick={() => autoMapMutation.mutate({ environmentId: selectedEnvironmentId, containerId: containerDetail.data!.id })}
                      >
                        Retry automap
                      </Button>
                    </div>
                    <div className="mt-4">
                      <DataTable
                        headers={["Service", "Host", "Route", "Container port", "Status"]}
                        rows={
                          containerDetail.data.automapCandidates.length
                            ? containerDetail.data.automapCandidates.map((c) => [
                                c.service,
                                c.dnsName,
                                `${c.routeProtocol.toUpperCase()} → ${c.listenPort}`,
                                `${c.privatePort}/${c.protocol}${c.publicPort ? ` → ${c.publicPort}` : ""}`,
                                c.alreadyMapped
                                  ? <Badge key="mapped" variant="success">{c.existingRouteName ?? "Mapped"}</Badge>
                                  : <Badge key="ready" variant="default">Ready</Badge>
                              ])
                            : [["-", "No aegis labels detected", "-", "-", "-"]]
                        }
                      />
                    </div>
                    {containerDetail.data.automapIssues.length > 0 && (
                      <div className="mt-4">
                        <h4 className="mb-3 text-sm font-semibold text-foreground">Automap issues</h4>
                        <DataTable
                          headers={["Service", "Problem", "Labels", "Severity"]}
                          rows={containerDetail.data.automapIssues.map((issue) => [
                            issue.service, issue.message, issue.labels.join(", "),
                            <Badge key="sev" variant="danger">{issue.severity}</Badge>
                          ])}
                        />
                      </div>
                    )}
                    {containerDetail.data.automapEvents.length > 0 && (
                      <div className="mt-4">
                        <h4 className="mb-3 text-sm font-semibold text-foreground">Recent automap events</h4>
                        <DataTable
                          headers={["Time", "Topic", "Payload"]}
                          rows={containerDetail.data.automapEvents.map((event) => [
                            formatTimestamp(event.createdAt), event.topic, compactJson(event.payload)
                          ])}
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Exposed ports</h3>
                    {containerDetail.data.exposedPorts.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                        No ports exposed by this container.
                      </p>
                    ) : (
                      <DataTable
                        headers={["Port", "Published bindings", "Aegis mapping", "Action"]}
                        rows={containerDetail.data.exposedPorts.map((port) => {
                          const existing = containerDetail.data!.mappings.filter(
                            (m) => m.privatePort === port.privatePort && m.protocol === port.protocol
                          );
                          return [
                            <span key="port" className="font-mono text-sm">{port.privatePort}/{port.protocol}</span>,
                            port.publishedBindings.length
                              ? port.publishedBindings.map((b) => `${b.hostIp ?? "*"}:${b.publicPort}`).join(", ")
                              : <span className="text-muted-foreground">Direct container only</span>,
                            existing.length
                              ? <div key="m" className="flex flex-wrap gap-1">{existing.map((m) => <Badge key={m.id} variant="success">{m.proxyRouteName ?? `Route ${m.proxyRouteId}`}</Badge>)}</div>
                              : <Badge key="u" variant="muted">Not mapped</Badge>,
                            <PortMappingDialog
                              key={`${port.privatePort}-${port.protocol}`}
                              container={containerDetail.data!}
                              port={port}
                              loading={createMappingMutation.isPending}
                              error={dialogError}
                              onSubmit={(values) =>
                                createMappingMutation.mutate({
                                  environmentId: selectedEnvironmentId,
                                  containerId: containerDetail.data!.id,
                                  privatePort: port.privatePort,
                                  publicPort: port.publishedBindings[0]?.publicPort ?? null,
                                  protocol: port.protocol,
                                  ...normalizeMappingForm(values)
                                })
                              }
                              networkInterfaces={networkInterfaces.data?.interfaces ?? []}
                            />
                          ];
                        })}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-destructive">Failed to load container details.</p>
              )
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function ContainerCard({
  container,
  onClick
}: {
  container: DockerContainerListItem;
  onClick: () => void;
}) {
  const hasAegisLabels = Object.keys(container.labels ?? {}).some((k) => k.startsWith("aegis."));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      className="cursor-pointer rounded-lg border border-border bg-background/30 p-4 text-left transition-all hover:border-primary/30 hover:bg-background/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex items-start justify-between gap-2">
        <StateBadge state={container.state} />
        <div className="flex shrink-0 flex-wrap gap-1">
          {container.mappings.length > 0 && (
            <Badge variant="default">{container.mappings.length} mapped</Badge>
          )}
          {hasAegisLabels && (
            <Badge variant="success">aegis</Badge>
          )}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-sm font-semibold leading-tight text-foreground">{container.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{container.image}</p>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{container.status}</p>

      {container.publishedPorts.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {container.publishedPorts.map((port, i) => (
            <span
              key={i}
              className="rounded border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {port.privatePort}/{port.protocol}
              {port.publicPort ? ` → ${port.publicPort}` : ""}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground/60">No published ports</p>
      )}

    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const stateMap: Record<string, { variant: BadgeVariant; label: string }> = {
    running: { variant: "success", label: "Running" },
    restarting: { variant: "warning", label: "Restarting" },
    paused: { variant: "warning", label: "Paused" },
    exited: { variant: "muted", label: "Exited" },
    dead: { variant: "danger", label: "Dead" },
    created: { variant: "muted", label: "Created" },
    removing: { variant: "warning", label: "Removing" }
  };
  const { variant, label } = stateMap[state] ?? { variant: "muted" as BadgeVariant, label: state };
  if (state === "running") {
    return (
      <Badge variant={variant}>
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant={variant} dot>
      {label}
    </Badge>
  );
}

function CardTopNav({
  backTarget,
  items
}: {
  backTarget: string | null;
  items: Array<{ label: string; to?: string }>;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {items.map((item, index) => (
          <div key={`${item.label}-${index}`} className="flex items-center gap-2">
            {index > 0 ? <ArrowRight className="h-4 w-4" /> : null}
            {item.to ? (
              <Link to={item.to} className="hover:text-foreground">
                {item.label}
              </Link>
            ) : (
              <span>{item.label}</span>
            )}
          </div>
        ))}
      </div>
      {backTarget ? (
        <Link to={backTarget} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      ) : null}
    </div>
  );
}

function EnvironmentDialog({
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
  initialValues?: EnvironmentForm;
  onSubmit: (values: EnvironmentForm) => Promise<void>;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, watch, setValue, formState: { errors: envErrors } } = useForm<EnvironmentForm>({
    defaultValues:
      initialValues ??
      ({
        name: "",
        connectionType: "local_socket",
        socketPath: "/var/run/docker.sock",
        host: "",
        port: null,
        tlsCaPem: "",
        tlsCertPem: "",
        tlsKeyPem: "",
        publicIp: "",
        enabled: true
      } satisfies EnvironmentForm)
  });

  const connectionType = watch("connectionType");

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
          onSubmit={handleSubmit(async (values) => {
            await onSubmit(values);
            setOpen(false);
          })}
        >
          <Field label="Name" error={envErrors.name?.message}>
            <Input {...register("name", { required: "Environment name is required", minLength: { value: 2, message: "Must be at least 2 characters" }, maxLength: { value: 120, message: "Max 120 characters" } })} />
          </Field>
          <Field label="Connection type">
            <Select value={connectionType} onValueChange={(value: EnvironmentForm["connectionType"]) => setValue("connectionType", value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local_socket">Local socket</SelectItem>
                <SelectItem value="tcp">Remote TCP</SelectItem>
                <SelectItem value="tls">Remote TLS</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {connectionType === "local_socket" ? (
            <Field label="Socket path" className="md:col-span-2">
              <Input {...register("socketPath")} />
              <p className="mt-1 text-xs text-muted-foreground">
                If Aegis runs in Docker, mount the host socket into this container at the same path.
              </p>
            </Field>
          ) : (
            <>
              <Field label="Host">
                <Input {...register("host")} />
              </Field>
              <Field label="Port">
                <Input
                  type="number"
                  {...register("port", {
                    setValueAs: (value) => (value === "" ? null : Number(value))
                  })}
                />
              </Field>
            </>
          )}
          <Field label="Public IP of Docker host" className="md:col-span-2" error={envErrors.publicIp?.message}>
            <Input
              placeholder="203.0.113.10"
              {...register("publicIp", {
                required: "Public IP is required",
                minLength: { value: 3, message: "Enter a valid IP or hostname" },
                maxLength: { value: 255, message: "Max 255 characters" }
              })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              This should be the address of the Docker host, not the Aegis container IP.
            </p>
          </Field>
          {connectionType === "tls" ? (
            <>
              <Field label="TLS CA PEM" className="md:col-span-2">
                <textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register("tlsCaPem")} />
              </Field>
              <Field label="TLS cert PEM" className="md:col-span-2">
                <textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register("tlsCertPem")} />
              </Field>
              <Field label="TLS key PEM" className="md:col-span-2">
                <textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register("tlsKeyPem")} />
              </Field>
            </>
          ) : null}
          <Field label="Enabled" className="md:col-span-2">
            <div className="flex h-10 items-center justify-between rounded-md border border-input bg-secondary/60 px-3">
              <span className="text-sm text-muted-foreground">Include this environment in discovery</span>
              <Switch checked={watch("enabled")} onCheckedChange={(value) => setValue("enabled", value)} />
            </div>
          </Field>
          {error ? <p className="md:col-span-2 text-sm text-destructive">{error}</p> : null}
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

function PortMappingDialog({
  container,
  port,
  loading,
  error,
  networkInterfaces,
  onSubmit
}: {
  container: DockerContainerDetail;
  port: DockerContainerDetail["exposedPorts"][number];
  loading: boolean;
  error: string | null;
  networkInterfaces: NetworkInterface[];
  onSubmit: (values: MappingForm) => void;
}) {
  const [open, setOpen] = useState(false);
  const defaultProtocol: MappingForm["routeProtocol"] = port.protocol === "udp" ? "udp" : port.privatePort === 80 || port.privatePort === 8080 ? "http" : "tcp";
  const { register, handleSubmit, watch, setValue } = useForm<MappingForm>({
    defaultValues: {
      dnsName: "",
      routeName: `${container.name}-${port.privatePort}`,
      routeProtocol: defaultProtocol,
      networkInterfaceId: null,
      listenAddress: "0.0.0.0",
      listenPort: defaultProtocol === "http" ? 80 : port.privatePort,
      sourcePath: "/",
      preserveHost: true,
      enabled: true
    }
  });

  const routeProtocol = watch("routeProtocol");
  const isHttpFamily = routeProtocol === "http" || routeProtocol === "https";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Map
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Map container port</DialogTitle>
          <DialogDescription>
            Create an Aegis proxy route for {container.name}:{port.privatePort}/{port.protocol}. A DNS record is created automatically, and HTTPS uses the default Root CA to issue a server certificate.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={handleSubmit((values) => {
            onSubmit(values);
            setOpen(false);
          })}
        >
          <Field label="Route name">
            <Input {...register("routeName")} />
          </Field>
          <Field label="DNS name">
            <Input placeholder="app.example.lan" {...register("dnsName")} />
          </Field>
          <Field label="Route protocol">
            <Select
              value={routeProtocol}
              onValueChange={(value: MappingForm["routeProtocol"]) => {
                setValue("routeProtocol", value);
                if (value === "https") {
                  setValue("listenAddress", HTTPS_LISTENER.address);
                  setValue("listenPort", HTTPS_LISTENER.port);
                } else if (value === "http") {
                  setValue("listenAddress", HTTP_LISTENER.address);
                  setValue("listenPort", HTTP_LISTENER.port);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {port.protocol === "tcp" ? (
                  <>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="https">HTTPS</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                  </>
                ) : (
                  <SelectItem value="udp">UDP</SelectItem>
                )}
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
          {isHttpFamily ? (
            <>
              <Field label="Source path">
                <Input placeholder="/" {...register("sourcePath")} />
              </Field>
              <Field label="Preserve host" className="md:col-span-2">
                <div className="flex h-10 items-center justify-between rounded-md border border-input bg-secondary/60 px-3">
                  <span className="text-sm text-muted-foreground">Forward the original host header</span>
                  <Switch checked={watch("preserveHost")} onCheckedChange={(value) => setValue("preserveHost", value)} />
                </div>
              </Field>
            </>
          ) : null}
          <Field label="Enabled" className="md:col-span-2">
            <div className="flex h-10 items-center justify-between rounded-md border border-input bg-secondary/60 px-3">
              <span className="text-sm text-muted-foreground">Activate this route immediately</span>
              <Switch checked={watch("enabled")} onCheckedChange={(value) => setValue("enabled", value)} />
            </div>
          </Field>
          {error ? <p className="md:col-span-2 text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="md:col-span-2 gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={loading}>
              Create mapping
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/30 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

type DockerResourceStats = {
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  sampledContainers: number;
};

type StatHistory = {
  cpu: number[];
  memPct: number[];
  netTotal: number[];
};

function EnvironmentResourceStatsRow({ environmentId }: { environmentId: number }) {
  const [history, setHistory] = useState<StatHistory>({ cpu: [], memPct: [], netTotal: [] });
  const prevNetRef = useRef<{ rx: number; tx: number } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["docker-resource-stats", environmentId],
    queryFn: () => api<DockerResourceStats>(`/api/docker/environments/${environmentId}/resource-stats`),
    refetchInterval: 5_000,
    staleTime: 0
  });

  useEffect(() => {
    if (!data) return;
    const memPct = data.memoryTotalBytes > 0 ? (data.memoryUsedBytes / data.memoryTotalBytes) * 100 : 0;
    const prev = prevNetRef.current;
    const netDelta = prev
      ? Math.max(0, (data.networkRxBytes + data.networkTxBytes) - (prev.rx + prev.tx))
      : 0;
    prevNetRef.current = { rx: data.networkRxBytes, tx: data.networkTxBytes };
    setHistory((h) => ({
      cpu: [...h.cpu.slice(-19), data.cpuPercent],
      memPct: [...h.memPct.slice(-19), memPct],
      netTotal: [...h.netTotal.slice(-19), netDelta]
    }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="mt-4 grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-background/30" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const memPct = data.memoryTotalBytes > 0 ? (data.memoryUsedBytes / data.memoryTotalBytes) * 100 : 0;
  const cpuHigh = data.cpuPercent > 80;
  const memHigh = memPct > 85;

  return (
    <div className="mt-4 grid grid-cols-3 gap-3">
      <ResourceStatTile
        label="CPU"
        primary={`${data.cpuPercent.toFixed(1)}%`}
        secondary={`${data.sampledContainers} containers`}
        sparkValues={history.cpu}
        maxValue={100}
        lineColor="#3b82f6"
        fillColor="rgba(59,130,246,0.12)"
        borderClass={cpuHigh ? "border-amber-500/40" : "border-blue-500/20"}
        bgClass={cpuHigh ? "bg-amber-500/8" : "bg-blue-500/8"}
        valueClass={cpuHigh ? "text-amber-400" : "text-blue-300"}
      />
      <ResourceStatTile
        label="RAM"
        primary={formatBytes(data.memoryUsedBytes)}
        secondary={data.memoryTotalBytes > 0 ? `of ${formatBytes(data.memoryTotalBytes)}` : "no limit"}
        sparkValues={history.memPct}
        maxValue={100}
        lineColor="#8b5cf6"
        fillColor="rgba(139,92,246,0.12)"
        borderClass={memHigh ? "border-amber-500/40" : "border-violet-500/20"}
        bgClass={memHigh ? "bg-amber-500/8" : "bg-violet-500/8"}
        valueClass={memHigh ? "text-amber-400" : "text-violet-300"}
      />
      <ResourceStatTile
        label="Net I/O"
        primary={`↑ ${formatBytes(data.networkTxBytes)}`}
        secondary={`↓ ${formatBytes(data.networkRxBytes)}`}
        sparkValues={history.netTotal}
        lineColor="#06b6d4"
        fillColor="rgba(6,182,212,0.12)"
        borderClass="border-cyan-500/20"
        bgClass="bg-cyan-500/8"
        valueClass="text-cyan-300"
      />
    </div>
  );
}

function ResourceStatTile({
  label,
  primary,
  secondary,
  sparkValues,
  maxValue,
  lineColor,
  fillColor,
  borderClass,
  bgClass,
  valueClass
}: {
  label: string;
  primary: string;
  secondary: string;
  sparkValues: number[];
  maxValue?: number;
  lineColor: string;
  fillColor: string;
  borderClass: string;
  bgClass: string;
  valueClass: string;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl border px-3.5 pt-3.5 pb-2", borderClass, bgClass)}>
      <Sparkline values={sparkValues} maxValue={maxValue} lineColor={lineColor} fillColor={fillColor} />
      <div className="relative z-10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-lg font-bold tabular-nums leading-tight", valueClass)}>{primary}</p>
        <p className="mt-0.5 text-[10px] leading-none text-muted-foreground/70">{secondary}</p>
      </div>
    </div>
  );
}

function Sparkline({ values, maxValue, lineColor, fillColor }: {
  values: number[];
  maxValue?: number;
  lineColor: string;
  fillColor: string;
}) {
  if (values.length < 2) return null;
  const W = 100;
  const H = 32;
  const max = maxValue ?? Math.max(...values, 1);
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: H - (Math.min(v, max) / max) * (H - 4)
  }));
  const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaD = `M 0 ${H} ${pts.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")} L ${W} ${H} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="absolute inset-x-0 bottom-0 h-8 w-full"
    >
      <path d={areaD} fill={fillColor} />
      <path d={lineD} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ContainerDonut({
  running,
  restarting,
  stopped
}: {
  running: number;
  restarting: number;
  stopped: number;
}) {
  const total = running + restarting + stopped;
  const r = 24;
  const cx = 32;
  const cy = 32;
  const circumference = 2 * Math.PI * r;

  const runLen = total > 0 ? (running / total) * circumference : 0;
  const restLen = total > 0 ? (restarting / total) * circumference : 0;
  const stopLen = total > 0 ? (stopped / total) * circumference : 0;

  const segments = [
    { len: runLen, offset: 0, color: "#10b981" },
    { len: restLen, offset: -runLen, color: "#f59e0b" },
    { len: stopLen, offset: -(runLen + restLen), color: "#6b728080" }
  ].filter((s) => s.len > 0);

  return (
    <div className="relative shrink-0">
      <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
        {total === 0 ? (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-border" />
        ) : (
          segments.map((seg, i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth="7"
              strokeDasharray={`${seg.len} ${circumference - seg.len}`}
              strokeDashoffset={seg.offset}
            />
          ))
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold text-foreground">{total}</span>
      </div>
    </div>
  );
}

function ContainerStatsBar({ containers }: { containers: DockerContainerListItem[] }) {
  const running = containers.filter((c) => c.state === "running").length;
  const restarting = containers.filter((c) => c.state === "restarting" || c.state === "paused").length;
  const stopped = containers.length - running - restarting;
  const total = containers.length;

  if (total === 0) return null;

  return (
    <div className="space-y-2 rounded-md border border-border bg-background/30 p-3">
      <div className="flex h-1.5 overflow-hidden rounded-full">
        {running > 0 && (
          <div className="bg-emerald-500/80 transition-all" style={{ width: `${(running / total) * 100}%` }} />
        )}
        {restarting > 0 && (
          <div className="bg-amber-500/80 transition-all" style={{ width: `${(restarting / total) * 100}%` }} />
        )}
        {stopped > 0 && (
          <div className="bg-muted-foreground/25 transition-all" style={{ width: `${(stopped / total) * 100}%` }} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-[11px] text-muted-foreground">{running} running</span>
        </div>
        {restarting > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-[11px] text-muted-foreground">{restarting} restarting</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
          <span className="text-[11px] text-muted-foreground">{stopped} stopped</span>
        </div>
        <span className="ml-auto text-[11px] font-medium text-muted-foreground">{total} total</span>
      </div>
    </div>
  );
}

function normalizeEnvironmentForm(values: EnvironmentForm) {
  return {
    ...values,
    socketPath: values.socketPath || null,
    host: values.host || null,
    port: values.port ?? null,
    tlsCaPem: values.tlsCaPem || null,
    tlsCertPem: values.tlsCertPem || null,
    tlsKeyPem: values.tlsKeyPem || null
  };
}

function environmentToForm(environment: DockerEnvironment): EnvironmentForm {
  return {
    name: environment.name,
    connectionType: environment.connectionType,
    socketPath: environment.socketPath ?? "",
    host: environment.host ?? "",
    port: environment.port,
    tlsCaPem: environment.tlsCaPem ?? "",
    tlsCertPem: environment.tlsCertPem ?? "",
    tlsKeyPem: environment.tlsKeyPem ?? "",
    publicIp: environment.publicIp,
    enabled: environment.enabled
  };
}

function normalizeMappingForm(values: MappingForm) {
  const listener = values.routeProtocol === "https" ? HTTPS_LISTENER : values.routeProtocol === "http" ? HTTP_LISTENER : null;
  return {
    ...values,
    networkInterfaceId: values.networkInterfaceId,
    listenAddress: listener?.address ?? values.listenAddress.trim(),
    listenPort: listener?.port ?? values.listenPort,
    sourcePath: values.sourcePath.trim() || null
  };
}

function labelConnection(environment: DockerEnvironment) {
  if (environment.connectionType === "local_socket") {
    return environment.socketPath ?? "/var/run/docker.sock";
  }
  return `${environment.host ?? "host"}:${environment.port ?? "-"}`;
}

function labelConnectionType(environment: DockerEnvironment) {
  if (environment.connectionType === "local_socket") return "Local socket";
  if (environment.connectionType === "tls") return "TLS";
  return "TCP";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const compactJson = formatEventPayload;
