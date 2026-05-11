import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Globe,
  Lock,
  Network,
  Pencil,
  Plus,
  ServerCog,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
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
  bootstrapSteps?: {
    dnsConfigured: boolean;
    primaryCaConfigured: boolean;
    interfacesConfigured: boolean;
    completed: boolean;
  };
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

type BootstrapState = {
  bootstrapCompleted: boolean;
  steps: {
    dnsConfigured: boolean;
    primaryCaConfigured: boolean;
    interfacesConfigured: boolean;
    completed: boolean;
  };
  settings: Settings | null;
  certificateAuthority: {
    id: number;
    name: string;
    commonName: string;
    expiresAt: string;
    isDefault: boolean;
  } | null;
};

type BootstrapCaForm = {
  name: string;
  commonName: string;
  organization: string;
  organizationalUnit: string;
  country: string;
  state: string;
  locality: string;
  emailAddress: string;
  validityDays: number;
  pathLength: number | null;
};

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


type BootstrapForm = Settings;
type ZoneForm = Omit<Zone, "id"> & { description: string };
type RecordForm = Omit<RecordItem, "id" | "zoneName"> & { proxiedService: string };
type UpstreamForm = Omit<Upstream, "id" | "healthStatus">;
type BlocklistForm = Omit<BlocklistEntry, "id"> & { source: string };

const dnsTabs = [
  { value: "zones", label: "Zones" },
  { value: "records", label: "Records" },
  { value: "upstreams", label: "Upstreams" },
  { value: "blocklist", label: "Blocklist" }
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
  const refreshAll = () => {
    refreshDashboard();
    queryClient.invalidateQueries({ queryKey: ["dns-bootstrap"] });
    queryClient.invalidateQueries({ queryKey: ["network-interfaces-bootstrap"] });
  };

  const { data, isLoading } = useQuery({
    queryKey: ["dns-dashboard"],
    queryFn: () => api<Dashboard>("/api/dns/dashboard")
  });
  const bootstrapState = useQuery({
    queryKey: ["dns-bootstrap"],
    queryFn: () => api<BootstrapState>("/api/dns/bootstrap")
  });
  const networkInterfaces = useQuery({
    queryKey: ["network-interfaces-bootstrap"],
    queryFn: () => api<NetworkInterfacesState>("/api/network-interfaces")
  });

  const bootstrapSettingsMutation = useMutation({
    mutationFn: (payload: BootstrapForm) =>
      api("/api/dns/bootstrap/settings", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: refreshAll
  });
  const bootstrapCaMutation = useMutation({
    mutationFn: (payload: BootstrapCaForm) =>
      api("/api/dns/bootstrap/ca", { method: "POST", body: JSON.stringify(normalizeBootstrapCaForm(payload)) }),
    onSuccess: refreshAll
  });
  const bootstrapInterfacesMutation = useMutation({
    mutationFn: (payload: NetworkInterfaceConfig[]) =>
      api("/api/network-interfaces", { method: "POST", body: JSON.stringify(payload) }),
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

      </AppShell>

      {!data.bootstrapCompleted ? (
        <BootstrapOverlay
          bootstrap={bootstrapState.data}
          networkInterfaces={networkInterfaces.data}
          dnsLoading={bootstrapSettingsMutation.isPending}
          caLoading={bootstrapCaMutation.isPending}
          interfacesLoading={bootstrapInterfacesMutation.isPending}
          onSubmitDns={(values) => bootstrapSettingsMutation.mutate(values)}
          onSubmitCa={(values) => bootstrapCaMutation.mutate(values)}
          onSubmitInterfaces={(values) => bootstrapInterfacesMutation.mutate(values)}
          dnsError={bootstrapSettingsMutation.error instanceof Error ? bootstrapSettingsMutation.error.message : null}
          caError={bootstrapCaMutation.error instanceof Error ? bootstrapCaMutation.error.message : null}
          interfacesError={bootstrapInterfacesMutation.error instanceof Error ? bootstrapInterfacesMutation.error.message : null}
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

function normalizeBootstrapCaForm(payload: BootstrapCaForm) {
  return {
    ...payload,
    organization: payload.organization.trim() || null,
    organizationalUnit: payload.organizationalUnit.trim() || null,
    country: payload.country.trim() || null,
    state: payload.state.trim() || null,
    locality: payload.locality.trim() || null,
    emailAddress: payload.emailAddress.trim() || null,
    pathLength: payload.pathLength == null || Number.isNaN(payload.pathLength) ? null : payload.pathLength
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
  bootstrap,
  networkInterfaces,
  onSubmitDns,
  onSubmitCa,
  onSubmitInterfaces,
  dnsLoading,
  caLoading,
  interfacesLoading,
  dnsError,
  caError,
  interfacesError
}: {
  bootstrap?: BootstrapState;
  networkInterfaces?: NetworkInterfacesState;
  onSubmitDns: (values: BootstrapForm) => void;
  onSubmitCa: (values: BootstrapCaForm) => void;
  onSubmitInterfaces: (values: NetworkInterfaceConfig[]) => void;
  dnsLoading: boolean;
  caLoading: boolean;
  interfacesLoading: boolean;
  dnsError: string | null;
  caError: string | null;
  interfacesError: string | null;
}) {
  const dnsForm = useForm<BootstrapForm>({
    defaultValues: {
      organizationName: "Aegis Corp",
      primaryContactEmail: "dns@azienda.local",
      defaultZoneSuffix: "azienda.local",
      upstreamMode: "redundant",
      dnsListenPort: 53,
      blocklistEnabled: true
    }
  });
  const caForm = useForm<BootstrapCaForm>({
    defaultValues: {
      name: "Aegis Root CA",
      commonName: "Aegis Root CA",
      organization: bootstrap?.settings?.organizationName ?? "Aegis Corp",
      organizationalUnit: "Infrastructure",
      country: "IT",
      state: "",
      locality: "",
      emailAddress: bootstrap?.settings?.primaryContactEmail ?? "pki@azienda.local",
      validityDays: 3650,
      pathLength: 1
    }
  });
  const [selectedInterfaces, setSelectedInterfaces] = useState<NetworkInterfaceConfig[]>([]);

  useEffect(() => {
    if (!networkInterfaces) {
      return;
    }
    if (networkInterfaces.interfaces.length > 0) {
      setSelectedInterfaces(networkInterfaces.interfaces);
      return;
    }
    const defaults = networkInterfaces.availableInterfaces.map((entry, index) => ({
      ...entry,
      enabled: index === 0,
      isDefault: index === 0
    }));
    setSelectedInterfaces(defaults);
  }, [networkInterfaces]);

  const currentStep = !bootstrap?.steps.dnsConfigured
    ? "dns"
    : !bootstrap?.steps.primaryCaConfigured
      ? "ca"
      : !bootstrap?.steps.interfacesConfigured
        ? "interfaces"
        : "done";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,8,15,0.78)] p-6 backdrop-blur-sm">
      <Card className="w-full max-w-4xl border-primary/25 bg-card/95">
        <CardHeader>
          <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Initial Bootstrap
          </div>
          <CardTitle>Complete DNS, PKI and network bootstrap</CardTitle>
          <CardDescription>Finish the three required steps before publishing services: resolver config, root CA and machine interfaces.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <BootstrapStep title="1. DNS" done={bootstrap?.steps.dnsConfigured ?? false} />
            <BootstrapStep title="2. Root CA" done={bootstrap?.steps.primaryCaConfigured ?? false} />
            <BootstrapStep title="3. Interfaces" done={bootstrap?.steps.interfacesConfigured ?? false} />
          </div>

          {currentStep === "dns" ? (
            <form className="grid gap-4 rounded-lg border border-border p-4 md:grid-cols-2" onSubmit={dnsForm.handleSubmit(onSubmitDns)}>
              <Field label="Organization">
                <Input {...dnsForm.register("organizationName")} />
              </Field>
              <Field label="Primary contact">
                <Input type="email" {...dnsForm.register("primaryContactEmail")} />
              </Field>
              <Field label="Default zone suffix">
                <Input {...dnsForm.register("defaultZoneSuffix")} />
              </Field>
              <Field label="DNS port">
                <Input type="number" {...dnsForm.register("dnsListenPort", { valueAsNumber: true })} />
              </Field>
              <Field label="Upstream mode">
                <Select value={dnsForm.watch("upstreamMode")} onValueChange={(value: BootstrapForm["upstreamMode"]) => dnsForm.setValue("upstreamMode", value)}>
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
                  <Switch checked={dnsForm.watch("blocklistEnabled")} onCheckedChange={(value) => dnsForm.setValue("blocklistEnabled", value)} />
                </div>
              </Field>
              {dnsError ? <p className="md:col-span-2 text-sm text-destructive">{dnsError}</p> : null}
              <div className="md:col-span-2 flex justify-end">
                <Button type="submit" disabled={dnsLoading}>
                  Save DNS settings
                </Button>
              </div>
            </form>
          ) : null}

          {currentStep === "ca" ? (
            <form className="grid gap-4 rounded-lg border border-border p-4 md:grid-cols-2" onSubmit={caForm.handleSubmit(onSubmitCa)}>
              <Field label="CA name">
                <Input {...caForm.register("name")} />
              </Field>
              <Field label="Common name">
                <Input {...caForm.register("commonName")} />
              </Field>
              <Field label="Organization">
                <Input {...caForm.register("organization")} />
              </Field>
              <Field label="Email">
                <Input type="email" {...caForm.register("emailAddress")} />
              </Field>
              <Field label="Validity days">
                <Input type="number" {...caForm.register("validityDays", { valueAsNumber: true })} />
              </Field>
              <Field label="Path length">
                <Input type="number" {...caForm.register("pathLength", { valueAsNumber: true })} />
              </Field>
              {caError ? <p className="md:col-span-2 text-sm text-destructive">{caError}</p> : null}
              <div className="md:col-span-2 flex justify-end">
                <Button type="submit" disabled={caLoading}>
                  Create root CA
                </Button>
              </div>
            </form>
          ) : null}

          {currentStep === "interfaces" ? (
            <div className="space-y-3 rounded-lg border border-border p-4">
              {(selectedInterfaces.length > 0 ? selectedInterfaces : networkInterfaces?.availableInterfaces ?? []).map((entry, index) => (
                <div key={`${entry.name}-${entry.address}`} className="grid gap-3 rounded-md border border-border/70 p-3 md:grid-cols-[1.2fr_1.2fr_1fr_auto_auto] md:items-center">
                  <div>
                    <Label className="mb-2 block text-xs text-muted-foreground">Name</Label>
                    <Input
                      value={selectedInterfaces[index]?.name ?? entry.name}
                      onChange={(event) =>
                        setSelectedInterfaces((current) =>
                          current.map((item, itemIndex) => (itemIndex === index ? { ...item, name: event.target.value } : item))
                        )
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
                      checked={selectedInterfaces[index]?.enabled ?? false}
                      onCheckedChange={(value) =>
                        setSelectedInterfaces((current) =>
                          current.map((item, itemIndex) => (itemIndex === index ? { ...item, enabled: value, isDefault: value ? item.isDefault : false } : item))
                        )
                      }
                    />
                    <span className="text-sm">Enabled</span>
                  </div>
                  <Button
                    type="button"
                    variant={selectedInterfaces[index]?.isDefault ? "default" : "secondary"}
                    onClick={() =>
                      setSelectedInterfaces((current) =>
                        current.map((item, itemIndex) => ({
                          ...item,
                          isDefault: itemIndex === index
                        }))
                      )
                    }
                  >
                    Default
                  </Button>
                </div>
              ))}
              {interfacesError ? <p className="text-sm text-destructive">{interfacesError}</p> : null}
              <div className="flex justify-end">
                <Button type="button" disabled={interfacesLoading} onClick={() => onSubmitInterfaces(selectedInterfaces)}>
                  Save interfaces
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function BootstrapStep({ title, done }: { title: string; done: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${done ? "border-emerald-500/20 bg-emerald-500/5" : "border-border bg-background/30"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <Badge variant={done ? "success" : "muted"} dot>{done ? "Done" : "Pending"}</Badge>
      </div>
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
        <Badge key="kind" variant={zone.kind === "local" ? "default" : "muted"}>{zone.kind === "local" ? "Local" : "Forward"}</Badge>,
        `${zone.ttl}s`,
        <Badge key="state" variant={zone.enabled ? "success" : "muted"} dot>{zone.enabled ? "Active" : "Disabled"}</Badge>,
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
  const managed = records.filter((r) => r.proxiedService !== null);
  const custom = records.filter((r) => r.proxiedService === null);

  const recordCells = (record: RecordItem) => [
    <span key="fqdn" className="font-mono text-xs">{record.name}.{record.zoneName}</span>,
    <Badge key="type" variant={record.type === "A" || record.type === "AAAA" ? "default" : record.type === "CNAME" ? "warning" : "muted"}>{record.type}</Badge>,
    <span key="val" className="font-mono text-xs">{record.value}</span>,
    <Badge key="svc" variant="default">{record.proxiedService}</Badge>
  ];

  const managedRow = (record: RecordItem) => [
    ...recordCells(record),
    <div key="lock" className="flex justify-end">
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
        <Lock className="h-3 w-3" />
        Managed
      </span>
    </div>
  ];

  const customRow = (record: RecordItem) => [
    ...recordCells(record).slice(0, 3),
    record.proxiedService
      ? <Badge key="svc" variant="default">{record.proxiedService}</Badge>
      : <span key="unlinked" className="text-muted-foreground">—</span>,
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
  ];

  return (
    <div className="space-y-0 overflow-hidden rounded-md border border-border">
      {/* Managed section */}
      <div className="border-b border-border bg-primary/[0.03]">
        <div className="flex items-center gap-2.5 border-b border-primary/10 bg-primary/5 px-4 py-2.5">
          <Lock className="h-3.5 w-3.5 text-primary/60" />
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary/80">Managed</p>
          <Badge variant="default">{managed.length}</Badge>
          <p className="ml-1 text-xs text-muted-foreground">Auto-created by proxy routes and Docker automap — read-only</p>
        </div>
        <SimpleTable
          headers={["FQDN", "Type", "Value", "Service", ""]}
          rows={
            managed.length > 0
              ? managed.map(managedRow)
              : [[<span key="empty" className="text-muted-foreground/60 text-xs italic">No managed records yet</span>, "", "", "", ""]]
          }
          alignLastRight
        />
      </div>

      {/* Custom section */}
      <div>
        <div className="flex items-center gap-2.5 border-b border-border bg-secondary/30 px-4 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Custom</p>
          <Badge variant="muted">{custom.length}</Badge>
          <p className="ml-1 text-xs text-muted-foreground">Manually created records</p>
        </div>
        <SimpleTable
          headers={["FQDN", "Type", "Value", "Service", "Actions"]}
          rows={
            custom.length > 0
              ? custom.map(customRow)
              : [[<span key="empty" className="text-muted-foreground/60 text-xs italic">No custom records yet</span>, "", "", "", ""]]
          }
          alignLastRight
        />
      </div>
    </div>
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
        <span key="ep" className="font-mono text-xs">{upstream.address}:{upstream.port}</span>,
        <Badge key="proto" variant="default">{upstream.protocol.toUpperCase()}</Badge>,
        <Badge key="health" variant={upstream.healthStatus === "healthy" ? "success" : upstream.healthStatus === "degraded" ? "warning" : "muted"} dot>{upstream.healthStatus}</Badge>,
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
        <span key="pat" className="font-mono text-xs">{entry.pattern}</span>,
        <Badge key="kind" variant="muted">{entry.kind}</Badge>,
        entry.source ?? "manual",
        <Badge key="state" variant={entry.enabled ? "success" : "muted"} dot>{entry.enabled ? "Active" : "Disabled"}</Badge>,
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
          <DialogFooter className="md:col-span-2 gap-2">
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
      <DialogFooter className="md:col-span-2 gap-2">
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
