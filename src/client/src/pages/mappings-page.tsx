import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Boxes, Link2, RefreshCcw, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

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

type DockerEnvironment = {
  id: number;
  name: string;
  enabled: boolean;
  publicIp: string;
};

type DockerDashboard = {
  summary: { environments: number; enabledEnvironments: number; mappings: number };
  environments: DockerEnvironment[];
  environmentStats: Array<{ environmentId: number; running: number; restarting: number; stopped: number; error: string | null }>;
  mappings: DockerPortMapping[];
};

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
  targetProtocol: string;
  healthStatus: "unknown" | "healthy" | "degraded";
  enabled: boolean;
};

type ProxyDashboard = {
  summary: { routes: number; enabledRoutes: number; httpListeners: number; tcpListeners: number; udpListeners: number };
  routes: ProxyRoute[];
};

type EnrichedMapping = DockerPortMapping & {
  route: ProxyRoute | null;
  environmentName: string;
  environmentPublicIp: string;
};

export function MappingsPage() {
  const queryClient = useQueryClient();

  const docker = useQuery({
    queryKey: ["docker-dashboard"],
    queryFn: () => api<DockerDashboard>("/api/docker/dashboard")
  });

  const proxy = useQuery({
    queryKey: ["proxy-dashboard"],
    queryFn: () => api<ProxyDashboard>("/api/proxy/dashboard")
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["docker-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["proxy-dashboard"] });
  };

  const enriched = useMemo<EnrichedMapping[]>(() => {
    if (!docker.data || !proxy.data) return [];
    return docker.data.mappings.map((mapping) => {
      const route = proxy.data.routes.find((r) => r.id === mapping.proxyRouteId) ?? null;
      const environment = docker.data.environments.find((e) => e.id === mapping.environmentId);
      return {
        ...mapping,
        route,
        environmentName: environment?.name ?? `Environment ${mapping.environmentId}`,
        environmentPublicIp: environment?.publicIp ?? ""
      };
    });
  }, [docker.data, proxy.data]);

  const stats = useMemo(
    () => ({
      total: enriched.length,
      active: enriched.filter((m) => m.route?.enabled).length,
      healthy: enriched.filter((m) => m.route?.healthStatus === "healthy").length,
      degraded: enriched.filter((m) => m.route?.healthStatus === "degraded").length
    }),
    [enriched]
  );

  const byEnvironment = useMemo(() => {
    const groups = new Map<string, EnrichedMapping[]>();
    for (const mapping of enriched) {
      const key = mapping.environmentName;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(mapping);
    }
    return Array.from(groups.entries()).map(([name, mappings]) => ({ name, mappings }));
  }, [enriched]);

  const isLoading = docker.isLoading || proxy.isLoading;

  if (isLoading) {
    return (
      <AppShell title="Mappings" description="Container ports linked to Aegis proxy routes, with live route health.">
        <div className="rounded-lg border border-border bg-background/30 p-10 text-sm text-muted-foreground">
          Loading mappings...
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Mappings"
      description="Every Docker container port that has been bound to an Aegis proxy route — with its current health, listener and upstream target."
      actions={
        <Button variant="secondary" onClick={refresh}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      }
    >
      <div className="grid gap-4 xl:grid-cols-4">
        <MetricCard icon={Link2} label="Total mappings" value={stats.total} detail="container ports linked" />
        <MetricCard icon={ShieldCheck} label="Active routes" value={stats.active} detail="enabled in proxy plane" />
        <MetricCard
          icon={Activity}
          label="Healthy"
          value={stats.healthy}
          detail={stats.degraded > 0 ? `${stats.degraded} degraded` : "all reachable"}
          valueClassName={stats.degraded > 0 ? "text-amber-500" : undefined}
        />
        <MetricCard icon={Boxes} label="Environments" value={docker.data?.summary.enabledEnvironments ?? 0} detail="active Docker engines" />
      </div>

      {enriched.length === 0 ? (
        <Card className="bg-background/20">
          <CardContent className="px-4 py-12 text-center text-sm text-muted-foreground">
            No mappings yet.{" "}
            <Link to="/docker" className="text-primary hover:underline">
              Open Docker Discovery
            </Link>{" "}
            to register container ports and map them to proxy routes.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {byEnvironment.map(({ name, mappings }) => (
            <Card key={name} className="bg-background/20">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{name}</CardTitle>
                  <Badge variant="muted">{mappings.length}</Badge>
                </div>
                <CardDescription>
                  {mappings.filter((m) => m.route?.enabled).length} active ·{" "}
                  {mappings.filter((m) => m.route?.healthStatus === "healthy").length} healthy
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MappingsTable mappings={mappings} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function MappingsTable({ mappings }: { mappings: EnrichedMapping[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/40 text-xs uppercase tracking-[0.12em] text-muted-foreground">
            <th className="px-4 py-3 font-medium">Container</th>
            <th className="px-4 py-3 font-medium">Port</th>
            <th className="px-4 py-3 font-medium">Route</th>
            <th className="px-4 py-3 font-medium">Listen</th>
            <th className="px-4 py-3 font-medium">Target</th>
            <th className="px-4 py-3 font-medium text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {mappings.map((mapping) => (
            <MappingRow key={mapping.id} mapping={mapping} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MappingRow({ mapping }: { mapping: EnrichedMapping }) {
  const { route } = mapping;

  return (
    <tr className="border-b border-border/70 transition-colors hover:bg-secondary/20">
      <td className="px-4 py-3 align-middle">
        <p className="font-medium text-foreground">{mapping.containerName}</p>
        <p className="text-xs text-muted-foreground">{mapping.environmentPublicIp || mapping.environmentName}</p>
      </td>
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-xs text-foreground">{mapping.privatePort}/{mapping.protocol}</span>
          {mapping.publicPort != null && (
            <span className="font-mono text-xs text-muted-foreground">→ :{mapping.publicPort}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 align-middle">
        {route ? (
          <div className="flex flex-wrap items-center gap-2">
            <ProtocolBadge protocol={route.protocol} />
            <Link to="/proxy" className="font-medium text-primary hover:underline">
              {route.name}
            </Link>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Route #{mapping.proxyRouteId}</span>
        )}
      </td>
      <td className="px-4 py-3 align-middle">
        {route ? (
          <span className="font-mono text-xs text-muted-foreground">
            {route.listenAddress}:{route.listenPort}
            {(route.protocol === "http" || route.protocol === "https") && route.sourceHost
              ? ` · ${route.sourceHost}${route.sourcePath ?? ""}`
              : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 align-middle">
        {route ? (
          <span className="font-mono text-xs text-muted-foreground">
            {route.targetHost}:{route.targetPort}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col items-end gap-1">
          {route ? (
            <>
              <Badge variant={route.enabled ? "success" : "muted"} dot>
                {route.enabled ? "Active" : "Disabled"}
              </Badge>
              <Badge variant={healthVariant(route.healthStatus)} dot>
                {route.healthStatus}
              </Badge>
            </>
          ) : (
            <Badge variant="danger">Route missing</Badge>
          )}
        </div>
      </td>
    </tr>
  );
}

function ProtocolBadge({ protocol }: { protocol: "http" | "https" | "tcp" | "udp" }) {
  const variants: Record<string, BadgeVariant> = { http: "default", https: "success", tcp: "warning", udp: "muted" };
  return <Badge variant={variants[protocol] ?? "default"}>{protocol.toUpperCase()}</Badge>;
}

function healthVariant(status: string): BadgeVariant {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  return "muted";
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  valueClassName
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  detail: string;
  valueClassName?: string;
}) {
  return (
    <Card className="relative overflow-hidden bg-background/20">
      <CardContent className="flex items-center gap-4 p-5">
        <span className="pointer-events-none absolute -right-2 bottom-0 top-0 flex select-none items-center text-[72px] font-black leading-none text-foreground/[0.04]">
          {value}
        </span>
        <div className="relative rounded-md border border-primary/20 bg-primary/10 p-3">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="relative">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={cn("text-2xl font-semibold text-foreground", valueClassName)}>{value}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
