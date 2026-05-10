import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Boxes, Link2, Network, Pencil, Plus, RefreshCcw, Server, Trash2 } from "lucide-react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";

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
import { api } from "@/lib/api";

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
  publishedPorts: Array<{
    privatePort: number;
    publicPort: number | null;
    protocol: "tcp" | "udp";
    hostIp: string | null;
  }>;
  networkIps: string[];
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
  listenAddress: string;
  listenPort: number;
  sourcePath: string;
  preserveHost: boolean;
  enabled: boolean;
};

export function DockerPage() {
  return (
    <Routes>
      <Route path="/" element={<DockerWorkspace />} />
      <Route path=":environmentId" element={<DockerWorkspace />} />
      <Route path=":environmentId/containers/:containerId" element={<DockerWorkspace />} />
    </Routes>
  );
}

function DockerWorkspace() {
  const params = useParams();
  const navigate = useNavigate();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const queryClient = useQueryClient();

  const dashboard = useQuery({
    queryKey: ["docker-dashboard"],
    queryFn: () => api<DockerDashboard>("/api/docker/dashboard")
  });

  const selectedEnvironmentId = useMemo(() => {
    const fromRoute = Number(params.environmentId ?? 0);
    return Number.isFinite(fromRoute) ? fromRoute : 0;
  }, [params.environmentId]);

  const selectedContainerId = params.containerId ?? null;

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
  const hasEnvironmentRoute = Boolean(params.environmentId);
  const viewMode = selectedContainerId ? "detail" : hasEnvironmentRoute ? "containers" : "environments";
  const primaryTitle =
    viewMode === "environments" ? "Docker environments" : viewMode === "containers" ? "Containers" : "Container detail";
  const primaryDescription =
    viewMode === "environments"
      ? "Socket-local and remote engines registered in Aegis, with quick container health counts."
      : viewMode === "containers"
        ? selectedEnvironment
          ? `Containers discovered on ${selectedEnvironment.name}.`
          : "The selected environment could not be found."
        : containerDetail.data
          ? `${containerDetail.data.image} · ${containerDetail.data.status}`
          : "Inspect exposed ports, existing mappings and publishing actions.";
  const backTarget =
    viewMode === "detail" ? `/docker/${selectedEnvironment?.id}` : viewMode === "containers" ? "/docker" : null;

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
            onSubmit={(values) => createEnvironmentMutation.mutate(values)}
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
            <CardTopNav
              backTarget={backTarget}
              items={[
                { label: "Docker", to: "/docker" },
                ...(selectedEnvironment ? [{ label: selectedEnvironment.name, to: `/docker/${selectedEnvironment.id}` }] : []),
                ...(selectedContainerId && containerDetail.data ? [{ label: containerDetail.data.name }] : [])
              ]}
            />
            <CardTitle>{primaryTitle}</CardTitle>
            <CardDescription>{primaryDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {viewMode === "environments" ? (
              <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                {data.environments.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">No Docker environments yet.</p>
                ) : (
                  data.environments.map((environment) => {
                    const stats = data.environmentStats.find((item) => item.environmentId === environment.id);
                    return (
                      <div
                        key={environment.id}
                        className={`rounded-lg border p-4 ${selectedEnvironmentId === environment.id ? "border-primary/40 bg-primary/5" : "border-border bg-background/30"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button className="min-w-0 text-left" onClick={() => navigate(`/docker/${environment.id}`)}>
                            <p className="text-sm font-medium text-foreground">{environment.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {labelConnection(environment)} · public {environment.publicIp}
                            </p>
                          </button>
                          <div className="flex gap-2">
                            <EnvironmentDialog
                              title="Edit Docker environment"
                              description="Adjust connection and public addressing details."
                              submitLabel="Save changes"
                              loading={updateEnvironmentMutation.isPending}
                              error={dialogError}
                              initialValues={environmentToForm(environment)}
                              onSubmit={(values) => updateEnvironmentMutation.mutate({ id: environment.id, payload: values })}
                              trigger={
                                <Button variant="ghost" size="icon">
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
                        <div className="mt-4 grid grid-cols-3 gap-3">
                          <MiniStat label="Running" value={String(stats?.running ?? 0)} />
                          <MiniStat label="Restarting" value={String(stats?.restarting ?? 0)} />
                          <MiniStat label="Stopped" value={String(stats?.stopped ?? 0)} />
                        </div>
                        {stats?.error ? <p className="mt-3 text-xs text-destructive">{stats.error}</p> : null}
                      </div>
                    );
                  })
                )}
              </div>
            ) : viewMode === "containers" ? (
              selectedEnvironment ? (
                <DataTable
                  headers={["Container", "Image", "State", "Published ports", "Mappings"]}
                  rows={(containers.data ?? []).map((container) => [
                    <Link key={container.id} className="text-primary hover:underline" to={`/docker/${selectedEnvironment.id}/containers/${encodeURIComponent(container.id)}`}>
                      {container.name}
                    </Link>,
                    container.image,
                    container.status,
                    container.publishedPorts.length
                      ? container.publishedPorts.map((port) => `${port.privatePort}/${port.protocol}${port.publicPort ? ` -> ${port.publicPort}` : ""}`).join(", ")
                      : "None",
                    container.mappings.length ? container.mappings.map((mapping) => mapping.proxyRouteName ?? `Route ${mapping.proxyRouteId}`).join(", ") : "None"
                  ])}
                />
              ) : (
                <p className="rounded-md border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
                  The selected environment no longer exists. Go back to the environments list and choose another one.
                </p>
              )
            ) : selectedEnvironment && selectedContainerId && containerDetail.data ? (
              <div className="space-y-6">
                <div className="grid gap-4 lg:grid-cols-4">
                  <MiniStat label="State" value={containerDetail.data.state} />
                  <MiniStat label="Networks" value={containerDetail.data.networkIps.join(", ") || "n/a"} />
                  <MiniStat label="Mappings" value={String(containerDetail.data.mappings.length)} />
                  <MiniStat label="Public IP" value={containerDetail.data.environment.publicIp} />
                </div>

                <div className="rounded-md border border-border bg-background/30 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Automap labels</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Detected `aegis.*` labels can generate DNS, proxy routes and HTTPS certificates automatically.
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={
                        autoMapMutation.isPending ||
                        containerDetail.data.automapCandidates.filter((item) => !item.alreadyMapped).length === 0
                      }
                      onClick={() =>
                        autoMapMutation.mutate({
                          environmentId: selectedEnvironment.id,
                          containerId: containerDetail.data.id
                        })
                      }
                    >
                      Retry automap
                    </Button>
                  </div>
                  <div className="mt-4">
                    <DataTable
                      headers={["Service", "Host", "Route", "Container port", "Status"]}
                      rows={
                        containerDetail.data.automapCandidates.length
                          ? containerDetail.data.automapCandidates.map((candidate) => [
                              candidate.service === "default" ? "default" : candidate.service,
                              candidate.dnsName,
                              `${candidate.routeProtocol.toUpperCase()} -> ${candidate.listenPort}`,
                              `${candidate.privatePort}/${candidate.protocol}${candidate.publicPort ? ` -> ${candidate.publicPort}` : ""}`,
                              candidate.alreadyMapped ? `Mapped${candidate.existingRouteName ? ` (${candidate.existingRouteName})` : ""}` : "Ready"
                            ])
                          : [["-", "No aegis labels detected", "-", "-", "-"]]
                      }
                    />
                  </div>
                  {containerDetail.data.automapIssues.length ? (
                    <div className="mt-4">
                      <h4 className="mb-3 text-sm font-semibold text-foreground">Automap issues</h4>
                      <DataTable
                        headers={["Service", "Problem", "Labels", "Status"]}
                        rows={containerDetail.data.automapIssues.map((issue) => [
                          issue.service === "default" ? "default" : issue.service,
                          issue.message,
                          issue.labels.join(", "),
                          issue.severity
                        ])}
                      />
                    </div>
                  ) : null}
                  {containerDetail.data.automapEvents.length ? (
                    <div className="mt-4">
                      <h4 className="mb-3 text-sm font-semibold text-foreground">Recent automap events</h4>
                      <DataTable
                        headers={["Time", "Topic", "Payload"]}
                        rows={containerDetail.data.automapEvents.map((event) => [
                          formatTimestamp(event.createdAt),
                          event.topic,
                          compactJson(event.payload)
                        ])}
                      />
                    </div>
                  ) : null}
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-foreground">Exposed ports</h3>
                  <DataTable
                    headers={["Port", "Bindings", "Mapped in Aegis", "Action"]}
                    rows={containerDetail.data.exposedPorts.map((port) => {
                      const existing = containerDetail.data.mappings.filter(
                        (mapping) => mapping.privatePort === port.privatePort && mapping.protocol === port.protocol
                      );
                      return [
                        `${port.privatePort}/${port.protocol}`,
                        port.publishedBindings.length
                          ? port.publishedBindings.map((binding) => `${binding.hostIp ?? "*"}:${binding.publicPort}`).join(", ")
                          : "Direct container only",
                        existing.length ? existing.map((mapping) => mapping.proxyRouteName ?? `Route ${mapping.proxyRouteId}`).join(", ") : "Not mapped",
                        <PortMappingDialog
                          key={`${port.privatePort}-${port.protocol}`}
                          container={containerDetail.data}
                          port={port}
                          loading={createMappingMutation.isPending}
                          error={dialogError}
                          onSubmit={(values) =>
                            createMappingMutation.mutate({
                              environmentId: selectedEnvironment.id,
                              containerId: containerDetail.data.id,
                              privatePort: port.privatePort,
                              publicPort: port.publishedBindings[0]?.publicPort ?? null,
                              protocol: port.protocol,
                              ...values
                            })
                          }
                        />
                      ];
                    })}
                  />
                </div>
              </div>
            ) : (
              <>
                <p className="rounded-md border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
                  Unable to load the selected container.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
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
        <Button asChild variant="secondary" size="sm">
          <Link to={backTarget}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
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
  onSubmit: (values: EnvironmentForm) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, watch, setValue } = useForm<EnvironmentForm>({
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
          onSubmit={handleSubmit((values) => {
            onSubmit(values);
            setOpen(false);
          })}
        >
          <Field label="Name">
            <Input {...register("name")} />
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
          <Field label="Public IP" className="md:col-span-2">
            <Input placeholder="203.0.113.10" {...register("publicIp")} />
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

function PortMappingDialog({
  container,
  port,
  loading,
  error,
  onSubmit
}: {
  container: DockerContainerDetail;
  port: DockerContainerDetail["exposedPorts"][number];
  loading: boolean;
  error: string | null;
  onSubmit: (values: MappingForm) => void;
}) {
  const [open, setOpen] = useState(false);
  const defaultProtocol = port.protocol === "udp" ? "udp" : port.privatePort === 80 || port.privatePort === 8080 ? "http" : "tcp";
  const { register, handleSubmit, watch, setValue } = useForm<MappingForm>({
    defaultValues: {
      dnsName: "",
      routeName: `${container.name}-${port.privatePort}`,
      routeProtocol: defaultProtocol,
      listenAddress: "0.0.0.0",
      listenPort: defaultProtocol === "http" ? 80 : defaultProtocol === "https" ? 443 : port.privatePort,
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
            <Select value={routeProtocol} onValueChange={(value: MappingForm["routeProtocol"]) => setValue("routeProtocol", value)}>
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
          <Field label="Listen address">
            <Input {...register("listenAddress")} />
          </Field>
          <Field label="Listen port">
            <Input type="number" {...register("listenPort", { valueAsNumber: true })} />
          </Field>
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
          <DialogFooter className="md:col-span-2">
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

function DeleteDialog({
  title,
  description,
  submitLabel,
  loading,
  error,
  onConfirm
}: {
  title: string;
  description: string;
  submitLabel: string;
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
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<React.ReactNode>> }) {
  if (rows.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">No data yet.</p>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="hidden grid-cols-[repeat(auto-fit,minmax(0,1fr))] bg-secondary/60 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid">
        {headers.map((header) => (
          <div key={header}>{header}</div>
        ))}
      </div>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="grid gap-3 border-t border-border px-4 py-4 text-sm text-foreground md:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
          {row.map((cell, cellIndex) => (
            <div key={cellIndex} className={cellIndex === row.length - 1 ? "md:text-right" : ""}>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:hidden">
                {headers[cellIndex]}
              </span>
              {cell}
            </div>
          ))}
        </div>
      ))}
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
      <CardContent className="flex items-center gap-4 p-5">
        <div className="rounded-md border border-primary/20 bg-primary/10 p-3">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold text-foreground">{valueLabel ?? value ?? 0}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/30 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground break-words">{value}</p>
    </div>
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
      <Label className="mb-2 block">{label}</Label>
      {children}
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

function labelConnection(environment: DockerEnvironment) {
  if (environment.connectionType === "local_socket") {
    return environment.socketPath ?? "/var/run/docker.sock";
  }
  return `${environment.connectionType.toUpperCase()} ${environment.host ?? "host"}:${environment.port ?? "-"}`;
}

function formatTimestamp(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "n/a";
}

function compactJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value;
  }
}
