import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileKey2, Lock, Pencil, Plus, RefreshCcw, RotateCw, ShieldCheck, Trash2 } from "lucide-react";

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

type CertificateSubject = {
  id: number;
  name: string;
  parentSubjectId: number | null;
  parentSubjectName: string | null;
  commonName: string;
  organization: string | null;
  organizationalUnit: string | null;
  country: string | null;
  state: string | null;
  locality: string | null;
  emailAddress: string | null;
  createdAt: string;
  updatedAt: string;
};

type CertificateAuthority = {
  id: number;
  name: string;
  subjectId: number;
  issuerCaId: number | null;
  subjectName: string;
  issuerName: string | null;
  commonName: string;
  serialNumber: string;
  issuedAt: string;
  expiresAt: string;
  validityDays: number;
  pathLength: number | null;
  isSelfSigned: boolean;
  isDefault: boolean;
  active: boolean;
};

type ServerCertificate = {
  id: number;
  name: string;
  subjectId: number;
  caId: number;
  subjectName: string;
  caName: string;
  commonName: string;
  subjectAltNames: string[];
  serialNumber: string;
  issuedAt: string;
  expiresAt: string;
  validityDays: number;
  renewalDays: number;
  active: boolean;
};

type CertificatesDashboard = {
  summary: {
    subjects: number;
    certificateAuthorities: number;
    serverCertificates: number;
    expiringSoon: number;
  };
  subjects: CertificateSubject[];
  certificateAuthorities: CertificateAuthority[];
  serverCertificates: ServerCertificate[];
  managedServerCertificateIds: number[];
};

type SubjectForm = {
  name: string;
  parentSubjectId: number | null;
  commonName: string;
  organization: string;
  organizationalUnit: string;
  country: string;
  state: string;
  locality: string;
  emailAddress: string;
};

type CertificateAuthorityForm = {
  name: string;
  subjectId: number;
  issuerCaId: number | null;
  validityDays: number;
  pathLength: number | null;
  isDefault: boolean;
  active: boolean;
};

type ServerCertificateForm = {
  name: string;
  subjectId: number;
  caId: number;
  subjectAltNames: string;
  validityDays: number;
  renewalDays: number;
  active: boolean;
};

type SubjectTreeItem = {
  subject: CertificateSubject;
  depth: number;
};

const certificateTabs = [
  { value: "subjects", label: "Subjects" },
  { value: "cas", label: "CAs" },
  { value: "server", label: "Server Certs" }
];

export function CertificatesPage() {
  const [activeTab, setActiveTab] = useState("subjects");
  const queryClient = useQueryClient();
  const refreshDashboard = () => queryClient.invalidateQueries({ queryKey: ["certificates-dashboard"] });

  const dashboard = useQuery({
    queryKey: ["certificates-dashboard"],
    queryFn: () => api<CertificatesDashboard>("/api/certificates/dashboard")
  });

  const createSubjectMutation = useMutation({
    mutationFn: (payload: SubjectForm) =>
      api("/api/certificates/subjects", { method: "POST", body: JSON.stringify(normalizeSubjectForm(payload)) }),
    onSuccess: refreshDashboard
  });
  const updateSubjectMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: SubjectForm }) =>
      api(`/api/certificates/subjects/${id}`, { method: "PUT", body: JSON.stringify(normalizeSubjectForm(payload)) }),
    onSuccess: refreshDashboard
  });
  const deleteSubjectMutation = useMutation({
    mutationFn: (id: number) => api(`/api/certificates/subjects/${id}`, { method: "DELETE" }),
    onSuccess: refreshDashboard
  });

  const createCaMutation = useMutation({
    mutationFn: (payload: CertificateAuthorityForm) =>
      api("/api/certificates/cas", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: refreshDashboard
  });

  const createServerCertificateMutation = useMutation({
    mutationFn: (payload: ServerCertificateForm) =>
      api("/api/certificates/server-certificates", {
        method: "POST",
        body: JSON.stringify(normalizeServerCertificateForm(payload))
      }),
    onSuccess: refreshDashboard
  });

  const renewServerCertificateMutation = useMutation({
    mutationFn: (id: number) => api(`/api/certificates/server-certificates/${id}/renew`, { method: "POST" }),
    onSuccess: refreshDashboard
  });

  const dialogError = useMemo(() => {
    const errors = [
      createSubjectMutation.error,
      updateSubjectMutation.error,
      deleteSubjectMutation.error,
      createCaMutation.error,
      createServerCertificateMutation.error,
      renewServerCertificateMutation.error
    ];
    const first = errors.find((error) => error instanceof Error);
    return first instanceof Error ? first.message : null;
  }, [
    createSubjectMutation.error,
    updateSubjectMutation.error,
    deleteSubjectMutation.error,
    createCaMutation.error,
    createServerCertificateMutation.error,
    renewServerCertificateMutation.error
  ]);

  if (dashboard.isLoading || !dashboard.data) {
    return (
      <AppShell title="CA & Certificates" description="Internal PKI for LAN services, certificate issuance and controlled renewal.">
        <div className="rounded-lg border border-border bg-background/30 p-10 text-sm text-muted-foreground">
          Loading certificate authority workspace...
        </div>
      </AppShell>
    );
  }

  const data = dashboard.data;
  const orderedSubjects = orderSubjects(data.subjects);

  return (
    <AppShell
      title="CA & Certificates"
      description="Define reusable certificate subjects, mint internal certificate authorities and issue server TLS certificates with managed renewal."
      actions={
        <>
          <Tabs value={activeTab} onValueChange={setActiveTab} tabs={certificateTabs} />
          <Button variant="secondary" onClick={refreshDashboard}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          {activeTab === "subjects" ? (
            <SubjectDialog
              title="Add subject"
              description="Create a reusable X.509 subject profile for CAs and server certificates."
              submitLabel="Create subject"
              loading={createSubjectMutation.isPending}
              error={dialogError}
              subjects={orderedSubjects}
              onSubmit={(values) => createSubjectMutation.mutate(values)}
              trigger={
                <Button>
                  <Plus className="h-4 w-4" />
                  Add subject
                </Button>
              }
            />
          ) : null}
          {activeTab === "cas" ? (
            <CertificateAuthorityDialog
              title="Create CA"
              description="Issue a self-signed root CA or an intermediate CA signed by an existing authority."
              submitLabel="Create CA"
              subjects={orderedSubjects}
              authorities={data.certificateAuthorities}
              loading={createCaMutation.isPending}
              error={dialogError}
              onSubmit={(values) => createCaMutation.mutate(values)}
              trigger={
                <Button>
                  <Plus className="h-4 w-4" />
                  Create CA
                </Button>
              }
            />
          ) : null}
          {activeTab === "server" ? (
            <ServerCertificateDialog
              title="Issue certificate"
              description="Issue a TLS certificate from one of your certificate authorities."
              submitLabel="Issue certificate"
              subjects={orderedSubjects}
              authorities={data.certificateAuthorities}
              loading={createServerCertificateMutation.isPending}
              error={dialogError}
              onSubmit={(values) => createServerCertificateMutation.mutate(values)}
              trigger={
                <Button>
                  <Plus className="h-4 w-4" />
                  Issue certificate
                </Button>
              }
            />
          ) : null}
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-4">
        <MetricCard icon={FileKey2} label="Subjects" value={data.summary.subjects} detail="reusable distinguished names" />
        <MetricCard icon={ShieldCheck} label="CAs" value={data.summary.certificateAuthorities} detail="root and intermediate issuers" />
        <MetricCard icon={FileKey2} label="Server certs" value={data.summary.serverCertificates} detail="TLS materials in inventory" />
        <MetricCard icon={RotateCw} label="Expiring soon" value={data.summary.expiringSoon} detail="inside renewal window" />
      </div>

      {activeTab === "subjects" ? (
        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>Subject inventory</CardTitle>
            <CardDescription>Reusable X.509 subject definitions used for certificate authorities and server certificates.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              headers={["Name", "Parent", "Common name", "Organization", "Email", "Actions"]}
              rows={orderedSubjects.map(({ subject, depth }) => [
                <SubjectTreeLabel key={subject.id} name={subject.name} depth={depth} />,
                subject.parentSubjectName ?? "Root",
                subject.commonName,
                subject.organization ?? "n/a",
                subject.emailAddress ?? "n/a",
                <div key={subject.id} className="flex justify-end gap-2">
                  <SubjectDialog
                    title="Edit subject"
                    description="Adjust the reusable subject fields."
                    submitLabel="Save changes"
                    loading={updateSubjectMutation.isPending}
                    error={dialogError}
                    subjects={orderedSubjects.filter((item) => item.subject.id !== subject.id)}
                    initialValues={subjectToForm(subject)}
                    onSubmit={(values) => updateSubjectMutation.mutate({ id: subject.id, payload: values })}
                    trigger={
                      <Button variant="ghost" className="h-9 w-9 p-0">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <DeleteDialog
                    title="Delete subject"
                    description={`This will remove ${subject.name} if it is not already used by a CA or certificate.`}
                    submitLabel="Delete subject"
                    loading={deleteSubjectMutation.isPending}
                    error={dialogError}
                    onConfirm={() => deleteSubjectMutation.mutate(subject.id)}
                  />
                </div>
              ])}
            />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "cas" ? (
        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>Certificate authorities</CardTitle>
            <CardDescription>Authorities capable of signing additional X.509 certificates for your internal PKI.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              headers={["Name", "Subject", "Issuer", "Validity", "State", "Downloads"]}
              rows={data.certificateAuthorities.map((authority) => [
                authority.name,
                authority.commonName,
                authority.issuerName
                  ? <span key="issuer" className="text-sm">{authority.issuerName}</span>
                  : <Badge key="issuer" variant="muted">Self-signed</Badge>,
                <span key="validity" className="text-xs text-muted-foreground">{formatTimestamp(authority.issuedAt)} → {formatTimestamp(authority.expiresAt)}</span>,
                authority.isDefault
                  ? <Badge key="state" variant="success" dot>Default root</Badge>
                  : authority.active
                    ? <Badge key="state" variant="default" dot>Active</Badge>
                    : <Badge key="state" variant="muted">Disabled</Badge>,
                <div key={authority.id} className="flex justify-end gap-2">
                  <DownloadButton label="Certificate" onClick={() => downloadPem(`/api/certificates/cas/${authority.id}/download/certificate`)} />
                  <DownloadButton label="Key" onClick={() => downloadPem(`/api/certificates/cas/${authority.id}/download/key`)} />
                </div>
              ])}
            />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "server" ? (
        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>Server certificates</CardTitle>
            <CardDescription>TLS certificates signed by your internal certificate authorities, with SAN coverage and managed renewal.</CardDescription>
          </CardHeader>
          <CardContent>
            <ServerCertsTable
              certificates={data.serverCertificates}
              managedIds={data.managedServerCertificateIds}
              renewLoading={renewServerCertificateMutation.isPending}
              onRenew={(id) => renewServerCertificateMutation.mutate(id)}
            />
          </CardContent>
        </Card>
      ) : null}
    </AppShell>
  );
}

function SubjectDialog({
  title,
  description,
  submitLabel,
  loading,
  error,
  subjects,
  initialValues,
  onSubmit,
  trigger
}: {
  title: string;
  description: string;
  submitLabel: string;
  loading: boolean;
  error: string | null;
  subjects: SubjectTreeItem[];
  initialValues?: SubjectForm;
  onSubmit: (values: SubjectForm) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, watch, setValue } = useForm<SubjectForm>({
    defaultValues:
      initialValues ??
      ({
        name: "",
        parentSubjectId: null,
        commonName: "",
        organization: "",
        organizationalUnit: "",
        country: "",
        state: "",
        locality: "",
        emailAddress: ""
      } satisfies SubjectForm)
  });

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
          <Field label="Profile name">
            <Input {...register("name")} />
          </Field>
          <Field label="Parent subject">
            <Select
              value={watch("parentSubjectId") == null ? "root" : String(watch("parentSubjectId"))}
              onValueChange={(value) => setValue("parentSubjectId", value === "root" ? null : Number(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root">Root subject</SelectItem>
                {subjects.map(({ subject, depth }) => (
                  <SelectItem key={subject.id} value={String(subject.id)}>
                    {formatSubjectOptionLabel(subject.name, depth)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Common name">
            <Input placeholder={watch("parentSubjectId") == null ? "" : "inherit unless overridden"} {...register("commonName")} />
          </Field>
          <Field label="Organization">
            <Input {...register("organization")} />
          </Field>
          <Field label="Org unit">
            <Input {...register("organizationalUnit")} />
          </Field>
          <Field label="Country">
            <Input maxLength={2} {...register("country")} />
          </Field>
          <Field label="State">
            <Input {...register("state")} />
          </Field>
          <Field label="Locality">
            <Input {...register("locality")} />
          </Field>
          <Field label="Email">
            <Input type="email" {...register("emailAddress")} />
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

function CertificateAuthorityDialog({
  title,
  description,
      submitLabel,
      subjects,
      authorities,
  loading,
  error,
  onSubmit,
  trigger
}: {
  title: string;
  description: string;
  submitLabel: string;
  subjects: SubjectTreeItem[];
  authorities: CertificateAuthority[];
  loading: boolean;
  error: string | null;
  onSubmit: (values: CertificateAuthorityForm) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, watch, setValue } = useForm<CertificateAuthorityForm>({
    defaultValues: {
      name: "",
      subjectId: subjects[0]?.subject.id ?? 0,
      issuerCaId: null,
      validityDays: 1825,
      pathLength: 1,
      isDefault: false,
      active: true
    }
  });

  const issuerValue = watch("issuerCaId");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
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
          <Field label="CA name">
            <Input {...register("name")} />
          </Field>
          <Field label="Subject">
            <Select value={String(watch("subjectId"))} onValueChange={(value) => setValue("subjectId", Number(value))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {subjects.map(({ subject, depth }) => (
                  <SelectItem key={subject.id} value={String(subject.id)}>
                    {formatSubjectOptionLabel(subject.name, depth)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Issuer">
            <Select
              value={issuerValue == null ? "self" : String(issuerValue)}
              onValueChange={(value) => setValue("issuerCaId", value === "self" ? null : Number(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="self">Self-signed root</SelectItem>
                {authorities.map((authority) => (
                  <SelectItem key={authority.id} value={String(authority.id)}>
                    {authority.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Validity days">
            <Input type="number" {...register("validityDays", { valueAsNumber: true })} />
          </Field>
          <Field label="Path length">
            <Input
              type="number"
              {...register("pathLength", {
                setValueAs: (value) => (value === "" ? null : Number(value))
              })}
            />
          </Field>
          <Field label="Default root">
            <div className="flex h-10 items-center justify-between rounded-md border border-input bg-secondary/60 px-3">
              <span className="text-sm text-muted-foreground">Use this CA by default for HTTPS mappings</span>
              <Switch checked={watch("isDefault")} onCheckedChange={(value) => setValue("isDefault", value)} />
            </div>
          </Field>
          <Field label="Active">
            <div className="flex h-10 items-center justify-between rounded-md border border-input bg-secondary/60 px-3">
              <span className="text-sm text-muted-foreground">Enabled for issuance</span>
              <Switch checked={watch("active")} onCheckedChange={(value) => setValue("active", value)} />
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

function ServerCertificateDialog({
  title,
  description,
  submitLabel,
  subjects,
  authorities,
  loading,
  error,
  onSubmit,
  trigger
}: {
  title: string;
  description: string;
  submitLabel: string;
  subjects: SubjectTreeItem[];
  authorities: CertificateAuthority[];
  loading: boolean;
  error: string | null;
  onSubmit: (values: ServerCertificateForm) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, watch, setValue } = useForm<ServerCertificateForm>({
    defaultValues: {
      name: "",
      subjectId: subjects[0]?.subject.id ?? 0,
      caId: authorities[0]?.id ?? 0,
      subjectAltNames: "",
      validityDays: 397,
      renewalDays: 30,
      active: true
    }
  });

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
          <Field label="Certificate name">
            <Input {...register("name")} />
          </Field>
          <Field label="Subject">
            <Select value={String(watch("subjectId"))} onValueChange={(value) => setValue("subjectId", Number(value))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {subjects.map(({ subject, depth }) => (
                  <SelectItem key={subject.id} value={String(subject.id)}>
                    {formatSubjectOptionLabel(subject.name, depth)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Issuing CA">
            <Select value={String(watch("caId"))} onValueChange={(value) => setValue("caId", Number(value))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {authorities.filter((authority) => authority.active).map((authority) => (
                  <SelectItem key={authority.id} value={String(authority.id)}>
                    {authority.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Validity days">
            <Input type="number" {...register("validityDays", { valueAsNumber: true })} />
          </Field>
          <Field label="Renewal window">
            <Input type="number" {...register("renewalDays", { valueAsNumber: true })} />
          </Field>
          <Field label="Active">
            <div className="flex h-10 items-center justify-between rounded-md border border-input bg-secondary/60 px-3">
              <span className="text-sm text-muted-foreground">Keep certificate in active inventory</span>
              <Switch checked={watch("active")} onCheckedChange={(value) => setValue("active", value)} />
            </div>
          </Field>
          <Field label="SAN entries" className="md:col-span-2">
            <textarea
              className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="web.lan, api.lan, 10.0.0.15"
              {...register("subjectAltNames")}
            />
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

function ServerCertsTable({
  certificates,
  managedIds,
  renewLoading,
  onRenew
}: {
  certificates: ServerCertificate[];
  managedIds: number[];
  renewLoading: boolean;
  onRenew: (id: number) => void;
}) {
  const managedSet = new Set(managedIds);
  const managed = certificates.filter((c) => managedSet.has(c.id));
  const custom = certificates.filter((c) => !managedSet.has(c.id));
  const headers = ["Name", "Common name", "SAN", "Issuer", "Validity", "Actions"];

  const certCells = (certificate: ServerCertificate) => [
    certificate.name,
    certificate.commonName,
    <span key="san" className="font-mono text-xs">{certificate.subjectAltNames.join(", ")}</span>,
    certificate.caName,
    <span key="validity" className="text-xs text-muted-foreground">{formatTimestamp(certificate.issuedAt)} → {formatTimestamp(certificate.expiresAt)}</span>,
    <div key="actions" className="flex justify-end gap-2">
      <Button variant="ghost" className="h-9 w-9 p-0" onClick={() => onRenew(certificate.id)} disabled={renewLoading}>
        <RotateCw className="h-4 w-4" />
      </Button>
      <DownloadButton label="Certificate" onClick={() => downloadPem(`/api/certificates/server-certificates/${certificate.id}/download/certificate`)} />
      <DownloadButton label="Chain" onClick={() => downloadPem(`/api/certificates/server-certificates/${certificate.id}/download/chain`)} />
      <DownloadButton label="Key" onClick={() => downloadPem(`/api/certificates/server-certificates/${certificate.id}/download/key`)} />
    </div>
  ];

  const CertRow = ({ certificate, className }: { certificate: ServerCertificate; className?: string }) => (
    <div className={`grid gap-3 border-t border-border px-4 py-4 text-sm text-foreground md:grid-cols-[repeat(auto-fit,minmax(0,1fr))] ${className ?? ""}`}>
      {certCells(certificate).map((cell, cellIndex) => (
        <div key={cellIndex} className={cellIndex === headers.length - 1 ? "md:text-right" : ""}>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:hidden">
            {headers[cellIndex]}
          </span>
          {cell}
        </div>
      ))}
    </div>
  );

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="grid grid-cols-1">
        <div className="hidden grid-cols-[repeat(auto-fit,minmax(0,1fr))] bg-secondary/60 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid">
          {headers.map((h) => <div key={h}>{h}</div>)}
        </div>
        <div className="flex items-center gap-2.5 border-t border-border bg-primary/5 px-4 py-2.5">
          <Lock className="h-3.5 w-3.5 text-primary/60" />
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-primary/80">Managed</span>
          <Badge variant="default">{managed.length}</Badge>
          <span className="ml-1 text-xs text-muted-foreground">In use by proxy routes — read-only</span>
        </div>
        {managed.length === 0 ? (
          <div className="border-t border-border bg-primary/[0.03] px-4 py-6 text-xs italic text-muted-foreground/60">No managed certificates yet</div>
        ) : managed.map((certificate) => (
          <CertRow key={certificate.id} certificate={certificate} className="bg-primary/[0.03]" />
        ))}
        <div className="flex items-center gap-2.5 border-t border-border bg-secondary/30 px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Custom</span>
          <Badge variant="muted">{custom.length}</Badge>
          <span className="ml-1 text-xs text-muted-foreground">Manually created certificates</span>
        </div>
        {custom.length === 0 ? (
          <div className="border-t border-border px-4 py-6 text-xs italic text-muted-foreground/60">No custom certificates yet</div>
        ) : custom.map((certificate) => (
          <CertRow key={certificate.id} certificate={certificate} />
        ))}
      </div>
    </div>
  );
}

function DownloadButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" className="h-9 w-9 p-0" title={label} onClick={onClick}>
      <Download className="h-4 w-4" />
    </Button>
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
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<React.ReactNode>> }) {
  if (rows.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">No items yet.</p>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="grid grid-cols-1">
        <div className="hidden grid-cols-[repeat(auto-fit,minmax(0,1fr))] bg-secondary/60 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid">
          {headers.map((header) => (
            <div key={header}>{header}</div>
          ))}
        </div>
        {rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className="grid gap-3 border-t border-border px-4 py-4 text-sm text-foreground md:grid-cols-[repeat(auto-fit,minmax(0,1fr))]"
          >
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
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <Card className="bg-background/20">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="rounded-md border border-primary/20 bg-primary/10 p-3">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
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

function SubjectTreeLabel({ name, depth }: { name: string; depth: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground" style={{ width: depth * 16 }} aria-hidden />
      {depth > 0 ? <span className="text-muted-foreground">└</span> : null}
      <span className={depth > 0 ? "font-medium text-foreground" : "font-semibold text-foreground"}>{name}</span>
    </div>
  );
}

function orderSubjects(subjects: CertificateSubject[]): SubjectTreeItem[] {
  const byParent = new Map<number | null, CertificateSubject[]>();
  for (const subject of subjects) {
    const bucket = byParent.get(subject.parentSubjectId) ?? [];
    bucket.push(subject);
    byParent.set(subject.parentSubjectId, bucket);
  }

  for (const bucket of byParent.values()) {
    bucket.sort((left, right) => left.name.localeCompare(right.name));
  }

  const ordered: SubjectTreeItem[] = [];
  const visit = (parentId: number | null, depth: number) => {
    for (const subject of byParent.get(parentId) ?? []) {
      ordered.push({ subject, depth });
      visit(subject.id, depth + 1);
    }
  };

  visit(null, 0);
  return ordered;
}

function formatSubjectOptionLabel(name: string, depth: number) {
  return `${"\u00a0\u00a0".repeat(depth)}${depth > 0 ? "└ " : ""}${name}`;
}

function normalizeSubjectForm(payload: SubjectForm) {
  return {
    ...payload,
    parentSubjectId: payload.parentSubjectId,
    commonName: payload.commonName || null,
    organization: payload.organization || null,
    organizationalUnit: payload.organizationalUnit || null,
    country: payload.country || null,
    state: payload.state || null,
    locality: payload.locality || null,
    emailAddress: payload.emailAddress || null
  };
}

function normalizeServerCertificateForm(payload: ServerCertificateForm) {
  return {
    ...payload,
    subjectAltNames: payload.subjectAltNames
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  };
}

function subjectToForm(subject: CertificateSubject): SubjectForm {
  return {
    name: subject.name,
    parentSubjectId: subject.parentSubjectId,
    commonName: subject.commonName,
    organization: subject.organization ?? "",
    organizationalUnit: subject.organizationalUnit ?? "",
    country: subject.country ?? "",
    state: subject.state ?? "",
    locality: subject.locality ?? "",
    emailAddress: subject.emailAddress ?? ""
  };
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "n/a";
  }
  return new Date(value).toLocaleString();
}

async function downloadPem(path: string) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error("Download failed");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename=\"([^\"]+)\"/);
  const fileName = match?.[1] ?? "certificate.pem";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
