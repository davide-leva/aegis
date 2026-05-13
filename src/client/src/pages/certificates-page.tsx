import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileKey2, Loader2, Lock, Pencil, Plus, RefreshCcw, RotateCw, ShieldCheck, XCircle } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { MetricCard } from "@/components/ui/metric-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { humanizeError } from "@/lib/errors";
import { useAcmeProgress } from "@/hooks/use-acme-progress";
import { formatTimestamp } from "@/lib/format";

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

// ─── ACME / Cloudflare types ──────────────────────────────────────────────────

type CloudflareCredential = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type AcmeAccount = {
  id: number;
  name: string;
  email: string;
  directoryUrl: string;
  createdAt: string;
};

type AcmeCertificate = {
  id: number;
  name: string;
  acmeAccountId: number;
  acmeAccountName: string;
  cloudflareCredentialId: number;
  cloudflareCredentialName: string;
  domains: string[];
  serialNumber: string;
  issuedAt: string;
  expiresAt: string;
  renewalDays: number;
  active: boolean;
};

type AcmeAccountForm = { name: string; email: string; directoryUrl: string };
type AcmeCertForm = {
  name: string;
  domains: string;
  acmeAccountId: number;
  cloudflareCredentialId: number;
  renewalDays: number;
};

const ACME_DIRECTORIES = [
  { label: "Let's Encrypt (production)", value: "https://acme-v02.api.letsencrypt.org/directory" },
  { label: "Let's Encrypt (staging)", value: "https://acme-staging-v02.api.letsencrypt.org/directory" },
  { label: "ZeroSSL", value: "https://acme.zerossl.com/v2/DV90" }
];

const certificateTabs = [
  { value: "subjects", label: "Subjects" },
  { value: "cas", label: "CAs" },
  { value: "server", label: "Server Certs" },
  { value: "public", label: "Public Certs" },
  { value: "acme-accounts", label: "ACME Accounts" }
];

export function CertificatesPage() {
  const [activeTab, setActiveTab] = useState("subjects");
  const [acmeProgressVisible, setAcmeProgressVisible] = useState(false);
  const [acmeProgressTitle, setAcmeProgressTitle] = useState("Issuing certificate");
  const queryClient = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();
  const acmeProgress = useAcmeProgress();
  const refreshDashboard = () => queryClient.invalidateQueries({ queryKey: ["certificates-dashboard"] });

  const dashboard = useQuery({
    queryKey: ["certificates-dashboard"],
    queryFn: () => api<CertificatesDashboard>("/api/certificates/dashboard")
  });

  const createSubjectMutation = useMutation({
    mutationFn: (payload: SubjectForm) =>
      api("/api/certificates/subjects", { method: "POST", body: JSON.stringify(normalizeSubjectForm(payload)) }),
    onSuccess: refreshDashboard,
    onError: (err) => toastError("Failed to create subject", humanizeError(err))
  });
  const updateSubjectMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: SubjectForm }) =>
      api(`/api/certificates/subjects/${id}`, { method: "PUT", body: JSON.stringify(normalizeSubjectForm(payload)) }),
    onSuccess: refreshDashboard,
    onError: (err) => toastError("Failed to update subject", humanizeError(err))
  });
  const deleteSubjectMutation = useMutation({
    mutationFn: (id: number) => api(`/api/certificates/subjects/${id}`, { method: "DELETE" }),
    onSuccess: refreshDashboard,
    onError: (err) => toastError("Failed to delete subject", humanizeError(err))
  });

  const createCaMutation = useMutation({
    mutationFn: (payload: CertificateAuthorityForm) =>
      api("/api/certificates/cas", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: refreshDashboard,
    onError: (err) => toastError("Failed to create CA", humanizeError(err))
  });

  const createServerCertificateMutation = useMutation({
    mutationFn: (payload: ServerCertificateForm) =>
      api("/api/certificates/server-certificates", {
        method: "POST",
        body: JSON.stringify(normalizeServerCertificateForm(payload))
      }),
    onSuccess: refreshDashboard,
    onError: (err) => toastError("Failed to issue certificate", humanizeError(err))
  });

  const renewServerCertificateMutation = useMutation({
    mutationFn: (id: number) => api(`/api/certificates/server-certificates/${id}/renew`, { method: "POST" }),
    onSuccess: () => { refreshDashboard(); toastSuccess("Certificate renewed successfully"); },
    onError: (err) => toastError("Failed to renew certificate", humanizeError(err))
  });

  // ─── ACME / Cloudflare queries ─────────────────────────────────────────────

  const cloudflareCredsQuery = useQuery({
    queryKey: ["cloudflare-credentials"],
    queryFn: () => api<CloudflareCredential[]>("/api/cloudflare/credentials")
  });

  const acmeAccountsQuery = useQuery({
    queryKey: ["acme-accounts"],
    queryFn: () => api<AcmeAccount[]>("/api/acme/accounts")
  });

  const acmeCertsQuery = useQuery({
    queryKey: ["acme-certificates"],
    queryFn: () => api<AcmeCertificate[]>("/api/acme/certificates")
  });

  const createAcmeAccountMutation = useMutation({
    mutationFn: (payload: AcmeAccountForm) =>
      api("/api/acme/accounts", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["acme-accounts"] }),
    onError: (err) => toastError("Failed to register ACME account", humanizeError(err))
  });

  const deleteAcmeAccountMutation = useMutation({
    mutationFn: (id: number) => api(`/api/acme/accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["acme-accounts"] }),
    onError: (err) => toastError("Failed to delete ACME account", humanizeError(err))
  });

  const issueAcmeCertMutation = useMutation({
    mutationFn: (payload: { name: string; domains: string[]; acmeAccountId: number; cloudflareCredentialId: number; renewalDays: number }) =>
      api("/api/acme/certificates", { method: "POST", body: JSON.stringify(payload) }),
    onMutate: () => { acmeProgress.start(); setAcmeProgressTitle("Issuing certificate"); setAcmeProgressVisible(true); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["acme-certificates"] }); toastSuccess("Certificate issued successfully"); },
    onError: (err) => toastError("Failed to issue public certificate", humanizeError(err))
  });

  const renewAcmeCertMutation = useMutation({
    mutationFn: (id: number) => api(`/api/acme/certificates/${id}/renew`, { method: "POST" }),
    onMutate: () => { acmeProgress.start(); setAcmeProgressTitle("Renewing certificate"); setAcmeProgressVisible(true); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["acme-certificates"] }); toastSuccess("Certificate renewed successfully"); },
    onError: (err) => toastError("Failed to renew certificate", humanizeError(err))
  });

  const deleteAcmeCertMutation = useMutation({
    mutationFn: (id: number) => api(`/api/acme/certificates/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["acme-certificates"] }),
    onError: (err) => toastError("Failed to delete certificate", humanizeError(err))
  });

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
              onSubmit={(values) => createServerCertificateMutation.mutate(values)}
              trigger={
                <Button>
                  <Plus className="h-4 w-4" />
                  Issue certificate
                </Button>
              }
            />
          ) : null}
          {activeTab === "acme-accounts" ? (
            <AcmeAccountDialog
              title="Register ACME account"
              description="Register a new account with an ACME certificate authority."
              submitLabel="Register"
              loading={createAcmeAccountMutation.isPending}
              onSubmit={(values) => createAcmeAccountMutation.mutate(values)}
              trigger={
                <Button>
                  <Plus className="h-4 w-4" />
                  Register account
                </Button>
              }
            />
          ) : null}
          {activeTab === "public" ? (
            <IssueAcmeCertDialog
              title="Issue public certificate"
              description="Request a certificate from a public CA using DNS-01 challenge via Cloudflare."
              loading={issueAcmeCertMutation.isPending}
              accounts={acmeAccountsQuery.data ?? []}
              credentials={cloudflareCredsQuery.data ?? []}
              onSubmit={(values) => issueAcmeCertMutation.mutate(values)}
              trigger={
                <Button>
                  <Plus className="h-4 w-4" />
                  Issue public cert
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

      {activeTab === "acme-accounts" ? (
        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>ACME accounts</CardTitle>
            <CardDescription>Accounts registered with public certificate authorities (Let's Encrypt, ZeroSSL).</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              headers={["Name", "Email", "Directory", "Created", "Actions"]}
              rows={(acmeAccountsQuery.data ?? []).map((account) => [
                account.name,
                account.email,
                <span key="dir" className="text-xs text-muted-foreground">
                  {ACME_DIRECTORIES.find((d) => d.value === account.directoryUrl)?.label ?? account.directoryUrl}
                </span>,
                <span key="created" className="text-xs text-muted-foreground">{formatTimestamp(account.createdAt)}</span>,
                <div key="actions" className="flex justify-end gap-2">
                  <DeleteDialog
                    title="Delete ACME account"
                    description={`Remove account "${account.name}". Existing certificates remain valid but won't auto-renew.`}
                    submitLabel="Delete account"
                    loading={deleteAcmeAccountMutation.isPending}
                    onConfirm={() => deleteAcmeAccountMutation.mutate(account.id)}
                  />
                </div>
              ])}
            />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "public" ? (
        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>Public certificates</CardTitle>
            <CardDescription>Certificates issued by public CAs via ACME DNS-01 challenge through Cloudflare.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              headers={["Name", "Domains", "Account", "Validity", "Actions"]}
              rows={(acmeCertsQuery.data ?? []).map((cert) => [
                cert.name,
                <div key="domains" className="flex flex-wrap gap-1">
                  {cert.domains.map((d) => (
                    <Badge key={d} variant="muted" className="font-mono text-[10px]">{d}</Badge>
                  ))}
                </div>,
                cert.acmeAccountName,
                <span key="validity" className="text-xs text-muted-foreground">
                  {formatTimestamp(cert.issuedAt)} → {formatTimestamp(cert.expiresAt)}
                </span>,
                <div key="actions" className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    className="h-9 w-9 p-0"
                    title="Renew"
                    onClick={() => renewAcmeCertMutation.mutate(cert.id)}
                    disabled={renewAcmeCertMutation.isPending}
                  >
                    <RotateCw className="h-4 w-4" />
                  </Button>
                  <DownloadButton label="Certificate" onClick={() => downloadPem(`/api/acme/certificates/${cert.id}/download`)} />
                  <DeleteDialog
                    title="Delete certificate"
                    description={`Permanently remove "${cert.name}". The certificate will be revoked with the CA.`}
                    submitLabel="Delete certificate"
                    loading={deleteAcmeCertMutation.isPending}
                    onConfirm={() => deleteAcmeCertMutation.mutate(cert.id)}
                  />
                </div>
              ])}
            />
          </CardContent>
        </Card>
      ) : null}

      <AcmeProgressDialog
        open={acmeProgressVisible}
        title={acmeProgressTitle}
        steps={acmeProgress.steps}
        isRunning={issueAcmeCertMutation.isPending || renewAcmeCertMutation.isPending}
        onOpenChange={(open) => {
          if (!open && !issueAcmeCertMutation.isPending && !renewAcmeCertMutation.isPending) {
            setAcmeProgressVisible(false);
            acmeProgress.clear();
          }
        }}
      />
    </AppShell>
  );
}

function SubjectDialog({
  title,
  description,
  submitLabel,
  loading,
  subjects,
  initialValues,
  onSubmit,
  trigger
}: {
  title: string;
  description: string;
  submitLabel: string;
  loading: boolean;
  subjects: SubjectTreeItem[];
  initialValues?: SubjectForm;
  onSubmit: (values: SubjectForm) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<SubjectForm>({
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
          <Field label="Profile name" error={errors.name?.message}>
            <Input {...register("name", { required: "Profile name is required", minLength: { value: 2, message: "Must be at least 2 characters" }, maxLength: { value: 120, message: "Max 120 characters" } })} />
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
          <Field label="Common name" error={errors.commonName?.message}>
            <Input placeholder={watch("parentSubjectId") == null ? "" : "inherit unless overridden"} {...register("commonName", { maxLength: { value: 255, message: "Max 255 characters" } })} />
          </Field>
          <Field label="Organization" error={errors.organization?.message}>
            <Input {...register("organization", { maxLength: { value: 255, message: "Max 255 characters" } })} />
          </Field>
          <Field label="Org unit" error={errors.organizationalUnit?.message}>
            <Input {...register("organizationalUnit", { maxLength: { value: 255, message: "Max 255 characters" } })} />
          </Field>
          <Field label="Country" error={errors.country?.message}>
            <Input maxLength={2} {...register("country", { maxLength: { value: 2, message: "Use a 2-letter country code (e.g. US, IT)" } })} />
          </Field>
          <Field label="State" error={errors.state?.message}>
            <Input {...register("state", { maxLength: { value: 255, message: "Max 255 characters" } })} />
          </Field>
          <Field label="Locality" error={errors.locality?.message}>
            <Input {...register("locality", { maxLength: { value: 255, message: "Max 255 characters" } })} />
          </Field>
          <Field label="Email" error={errors.emailAddress?.message}>
            <Input type="email" {...register("emailAddress", { pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email address" } })} />
          </Field>
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
  onSubmit,
  trigger
}: {
  title: string;
  description: string;
  submitLabel: string;
  subjects: SubjectTreeItem[];
  authorities: CertificateAuthority[];
  loading: boolean;
  onSubmit: (values: CertificateAuthorityForm) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, watch, setValue, formState: { errors: caErrors } } = useForm<CertificateAuthorityForm>({
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
          <Field label="CA name" error={caErrors.name?.message}>
            <Input {...register("name", { required: "CA name is required", minLength: { value: 2, message: "Must be at least 2 characters" }, maxLength: { value: 120, message: "Max 120 characters" } })} />
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
          <Field label="Validity days" error={caErrors.validityDays?.message}>
            <Input type="number" {...register("validityDays", { valueAsNumber: true, required: "Validity is required", min: { value: 30, message: "Minimum 30 days" }, max: { value: 3650, message: "Maximum 3650 days (10 years)" } })} />
          </Field>
          <Field label="Path length" error={caErrors.pathLength?.message}>
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
  onSubmit,
  trigger
}: {
  title: string;
  description: string;
  submitLabel: string;
  subjects: SubjectTreeItem[];
  authorities: CertificateAuthority[];
  loading: boolean;
  onSubmit: (values: ServerCertificateForm) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, watch, setValue, formState: { errors: scErrors } } = useForm<ServerCertificateForm>({
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
          <Field label="Certificate name" error={scErrors.name?.message}>
            <Input {...register("name", { required: "Certificate name is required", minLength: { value: 2, message: "Must be at least 2 characters" }, maxLength: { value: 120, message: "Max 120 characters" } })} />
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
          <Field label="Validity days" error={scErrors.validityDays?.message}>
            <Input type="number" {...register("validityDays", { valueAsNumber: true, required: "Validity is required", min: { value: 1, message: "Must be at least 1 day" }, max: { value: 825, message: "Maximum 825 days" } })} />
          </Field>
          <Field label="Renewal window (days)" error={scErrors.renewalDays?.message}>
            <Input type="number" {...register("renewalDays", { valueAsNumber: true, required: "Renewal window is required", min: { value: 1, message: "Must be at least 1 day" }, max: { value: 365, message: "Maximum 365 days" } })} />
          </Field>
          <Field label="Active">
            <div className="flex h-10 items-center justify-between rounded-md border border-input bg-secondary/60 px-3">
              <span className="text-sm text-muted-foreground">Keep certificate in active inventory</span>
              <Switch checked={watch("active")} onCheckedChange={(value) => setValue("active", value)} />
            </div>
          </Field>
          <Field label="SAN entries" className="md:col-span-2" error={scErrors.subjectAltNames?.message}>
            <textarea
              className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="web.lan, api.lan, 10.0.0.15"
              {...register("subjectAltNames", { required: "At least one SAN entry is required" })}
            />
          </Field>
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

function AcmeAccountDialog({
  title,
  description,
  submitLabel,
  loading,
  onSubmit,
  trigger
}: {
  title: string;
  description: string;
  submitLabel: string;
  loading: boolean;
  onSubmit: (values: AcmeAccountForm) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, watch, setValue, formState: { errors: acmeAccErrors } } = useForm<AcmeAccountForm>({
    defaultValues: { name: "", email: "", directoryUrl: ACME_DIRECTORIES[0].value }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={handleSubmit((values) => {
            onSubmit(values);
            setOpen(false);
          })}
        >
          <Field label="Account name" error={acmeAccErrors.name?.message}>
            <Input placeholder="e.g. lets-encrypt-prod" {...register("name", { required: "Account name is required", minLength: { value: 2, message: "Must be at least 2 characters" } })} />
          </Field>
          <Field label="Email" error={acmeAccErrors.email?.message}>
            <Input type="email" placeholder="admin@example.com" {...register("email", { required: "Email is required", pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email address" } })} />
          </Field>
          <Field label="Directory">
            <Select value={watch("directoryUrl")} onValueChange={(value) => setValue("directoryUrl", value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACME_DIRECTORIES.map((dir) => (
                  <SelectItem key={dir.value} value={dir.value}>{dir.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={loading}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IssueAcmeCertDialog({
  title,
  description,
  loading,
  accounts,
  credentials,
  onSubmit,
  trigger
}: {
  title: string;
  description: string;
  loading: boolean;
  accounts: AcmeAccount[];
  credentials: CloudflareCredential[];
  onSubmit: (values: { name: string; domains: string[]; acmeAccountId: number; cloudflareCredentialId: number; renewalDays: number }) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, watch, setValue, formState: { errors: acmeCertErrors } } = useForm<AcmeCertForm>({
    defaultValues: {
      name: "",
      domains: "",
      acmeAccountId: accounts[0]?.id ?? 0,
      cloudflareCredentialId: credentials[0]?.id ?? 0,
      renewalDays: 30
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={handleSubmit((values) => {
            const domains = values.domains
              .split(/[\n,]+/)
              .map((d) => d.trim())
              .filter(Boolean);
            onSubmit({
              name: values.name,
              domains,
              acmeAccountId: values.acmeAccountId,
              cloudflareCredentialId: values.cloudflareCredentialId,
              renewalDays: values.renewalDays
            });
            setOpen(false);
          })}
        >
          <Field label="Certificate name" error={acmeCertErrors.name?.message}>
            <Input placeholder="e.g. wildcard-example-com" {...register("name", { required: "Certificate name is required", minLength: { value: 2, message: "Must be at least 2 characters" } })} />
          </Field>
          <Field label="Domains" error={acmeCertErrors.domains?.message}>
            <textarea
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="example.com, *.example.com"
              {...register("domains", { required: "At least one domain is required" })}
            />
          </Field>
          <Field label="ACME account">
            <Select
              value={String(watch("acmeAccountId"))}
              onValueChange={(value) => setValue("acmeAccountId", Number(value))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={String(account.id)}>{account.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Cloudflare credential">
            <Select
              value={String(watch("cloudflareCredentialId"))}
              onValueChange={(value) => setValue("cloudflareCredentialId", Number(value))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select credential" />
              </SelectTrigger>
              <SelectContent>
                {credentials.map((cred) => (
                  <SelectItem key={cred.id} value={String(cred.id)}>{cred.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Renewal window (days)">
            <Input type="number" {...register("renewalDays", { valueAsNumber: true })} />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={loading}>
              {loading ? "Issuing…" : "Issue certificate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AcmeProgressDialog({
  open,
  title,
  steps,
  isRunning,
  onOpenChange
}: {
  open: boolean;
  title: string;
  steps: { step: string; status: "running" | "done" | "error"; detail?: string }[];
  isRunning: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        onPointerDownOutside={(e) => { if (isRunning) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (isRunning) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isRunning
              ? "Please wait — this may take up to a minute while DNS propagation completes."
              : "Operation finished. Review the steps below and close when ready."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          {steps.length === 0 && isRunning ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Starting…</span>
            </div>
          ) : null}
          {steps.map((s) => (
            <div key={s.step} className="flex items-start gap-3">
              {s.status === "running" && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />}
              {s.status === "done" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />}
              {s.status === "error" && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight">{s.step}</p>
                {s.detail ? <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p> : null}
              </div>
            </div>
          ))}
        </div>
        {!isRunning ? (
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
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
