import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, EyeOff, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { humanizeError } from "@/lib/errors";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppConfig = {
  organizationName?: string;
  contactEmail?: string;
};

type CloudflareCredential = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type CredentialFormValues = { name: string; apiToken: string };

type CloudflareZone = {
  id: string;
  name: string;
  status: string;
  alreadyImported: boolean;
  needsUpgrade: boolean;
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [credDialog, setCredDialog] = useState<{ mode: "add" } | { mode: "edit"; id: number; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CloudflareCredential | null>(null);
  const [importTarget, setImportTarget] = useState<CloudflareCredential | null>(null);
  const { error: toastError, success: toastSuccess } = useToast();
  const queryClient = useQueryClient();

  // ─── General config ────────────────────────────────────────────────────────

  const configQuery = useQuery({
    queryKey: ["config-app"],
    queryFn: () => api<Record<string, string>>("/api/config/app")
  });

  const saveConfigMutation = useMutation({
    mutationFn: (values: AppConfig) =>
      api("/api/config/app", {
        method: "PUT",
        body: JSON.stringify({
          ...(values.organizationName !== undefined && { organizationName: values.organizationName }),
          ...(values.contactEmail !== undefined && { contactEmail: values.contactEmail })
        })
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config-app"] });
      toastSuccess("Settings saved");
    },
    onError: (err) => toastError("Failed to save settings", humanizeError(err))
  });

  // ─── Cloudflare credentials ────────────────────────────────────────────────

  const credentialsQuery = useQuery({
    queryKey: ["cloudflare-credentials"],
    queryFn: () => api<CloudflareCredential[]>("/api/cloudflare/credentials")
  });

  const createCredMutation = useMutation({
    mutationFn: (input: CredentialFormValues) =>
      api("/api/cloudflare/credentials", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-credentials"] });
      setCredDialog(null);
      toastSuccess("Credential added");
    },
    onError: (err) => toastError("Failed to add credential", humanizeError(err))
  });

  const updateCredMutation = useMutation({
    mutationFn: ({ id, ...input }: CredentialFormValues & { id: number }) =>
      api(`/api/cloudflare/credentials/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-credentials"] });
      setCredDialog(null);
      toastSuccess("Credential updated");
    },
    onError: (err) => toastError("Failed to update credential", humanizeError(err))
  });

  const deleteCredMutation = useMutation({
    mutationFn: (id: number) =>
      api(`/api/cloudflare/credentials/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-credentials"] });
      setDeleteTarget(null);
      toastSuccess("Credential deleted");
    },
    onError: (err) => toastError("Failed to delete credential", humanizeError(err))
  });

  const actions = (
    <Button onClick={() => setCredDialog({ mode: "add" })}>
      <Plus className="h-4 w-4" />
      Add credential
    </Button>
  );

  return (
    <AppShell
      title="Settings"
      description="Application-wide configuration, integration credentials and service settings."
      actions={actions}
    >
      <div className="space-y-8">
        {/* General */}
        <GeneralSection
          data={configQuery.data}
          isLoading={configQuery.isLoading}
          isSaving={saveConfigMutation.isPending}
          onSave={(values) => saveConfigMutation.mutate(values)}
        />

        {/* Cloudflare */}
        <CloudflareSection
          credentials={credentialsQuery.data ?? []}
          isLoading={credentialsQuery.isLoading}
          onAdd={() => setCredDialog({ mode: "add" })}
          onEdit={(c) => setCredDialog({ mode: "edit", id: c.id, name: c.name })}
          onDelete={(c) => setDeleteTarget(c)}
          onImportZones={(c) => setImportTarget(c)}
        />
      </div>

      {/* Credential dialog */}
      {credDialog && (
        <CredentialDialog
          mode={credDialog.mode}
          editId={credDialog.mode === "edit" ? credDialog.id : undefined}
          editName={credDialog.mode === "edit" ? credDialog.name : undefined}
          isPending={createCredMutation.isPending || updateCredMutation.isPending}
          onSubmit={(values) => {
            if (credDialog.mode === "add") {
              createCredMutation.mutate(values);
            } else {
              updateCredMutation.mutate({ id: credDialog.id, ...values });
            }
          }}
          onClose={() => setCredDialog(null)}
        />
      )}

      {/* Delete confirm dialog */}
      {deleteTarget && (
        <DeleteCredentialDialog
          credential={deleteTarget}
          isPending={deleteCredMutation.isPending}
          onConfirm={() => deleteCredMutation.mutate(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* Import zones dialog */}
      {importTarget && (
        <ImportZonesDialog
          credential={importTarget}
          onClose={() => setImportTarget(null)}
        />
      )}
    </AppShell>
  );
}

// ─── General section ──────────────────────────────────────────────────────────

function GeneralSection({
  data,
  isLoading,
  isSaving,
  onSave
}: {
  data?: Record<string, string>;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (values: AppConfig) => void;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<AppConfig>({
    values: {
      organizationName: data?.organizationName ?? "",
      contactEmail: data?.contactEmail ?? ""
    }
  });

  return (
    <Card className="bg-background/20">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div className="rounded-md border border-primary/20 bg-primary/10 p-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle>General</CardTitle>
            <CardDescription className="mt-0.5">Basic application identity settings.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <form onSubmit={handleSubmit(onSave)} className="space-y-4 max-w-lg">
            <div className="space-y-1.5">
              <Label htmlFor="organizationName">Organization name</Label>
              <Input id="organizationName" {...register("organizationName", { maxLength: { value: 255, message: "Max 255 characters" } })} placeholder="Acme Corp" />
              {errors.organizationName && <p className="text-xs text-destructive">{errors.organizationName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactEmail">Contact email</Label>
              <Input id="contactEmail" type="email" {...register("contactEmail", { pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email address" } })} placeholder="admin@example.com" />
              {errors.contactEmail && <p className="text-xs text-destructive">{errors.contactEmail.message}</p>}
            </div>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Cloudflare section ───────────────────────────────────────────────────────

function CloudflareSection({
  credentials,
  isLoading,
  onAdd,
  onEdit,
  onDelete,
  onImportZones
}: {
  credentials: CloudflareCredential[];
  isLoading: boolean;
  onAdd: () => void;
  onEdit: (c: CloudflareCredential) => void;
  onDelete: (c: CloudflareCredential) => void;
  onImportZones: (c: CloudflareCredential) => void;
}) {
  return (
    <Card className="bg-background/20">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="rounded-md border border-primary/20 bg-primary/10 p-2">
              <CloudflareIcon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle>Cloudflare integration</CardTitle>
              <CardDescription className="mt-0.5">
                API tokens used for DNS-01 ACME challenges. Tokens need <code className="text-xs bg-secondary/60 px-1 rounded">Zone:DNS:Edit</code> permission.
              </CardDescription>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : credentials.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-background/30 p-8 text-center text-sm text-muted-foreground">
            <p className="mb-1 font-medium">No Cloudflare credentials configured</p>
            <p className="text-xs">Add a Cloudflare API token to enable ACME DNS-01 certificate issuance.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary/60 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-[0.12em]">Name</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-[0.12em]">API token</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-[0.12em]">Added</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((cred) => (
                  <CredentialRow
                    key={cred.id}
                    credential={cred}
                    onEdit={() => onEdit(cred)}
                    onDelete={() => onDelete(cred)}
                    onImportZones={() => onImportZones(cred)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CredentialRow({
  credential,
  onEdit,
  onDelete,
  onImportZones
}: {
  credential: CloudflareCredential;
  onEdit: () => void;
  onDelete: () => void;
  onImportZones: () => void;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <tr className="border-t border-border/80">
      <td className="px-4 py-3 font-medium">{credential.name}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {revealed ? "stored securely — re-enter to update" : "••••••••••••••••"}
          </span>
          <button
            onClick={() => setRevealed((v) => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={revealed ? "Hide token" : "Show info"}
          >
            {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {new Date(credential.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onImportZones} title="Import zones from Cloudflare">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ─── Dialogs ──────────────────────────────────────────────────────────────────

function CredentialDialog({
  mode,
  editId: _editId,
  editName,
  isPending,
  onSubmit,
  onClose
}: {
  mode: "add" | "edit";
  editId?: number;
  editName?: string;
  isPending: boolean;
  onSubmit: (values: CredentialFormValues) => void;
  onClose: () => void;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<CredentialFormValues>({
    defaultValues: { name: editName ?? "", apiToken: "" }
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add Cloudflare credential" : "Update Cloudflare credential"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cf-name">Name</Label>
            <Input
              id="cf-name"
              {...register("name", { required: "Name is required", minLength: { value: 2, message: "Min 2 characters" } })}
              placeholder="My Cloudflare token"
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cf-token">API token</Label>
            <Input
              id="cf-token"
              type="password"
              {...register("apiToken", { required: "API token is required" })}
              placeholder={mode === "edit" ? "Enter new token to replace existing" : "Cloudflare API token"}
            />
            {errors.apiToken && <p className="text-xs text-destructive">{errors.apiToken.message}</p>}
            <p className="text-xs text-muted-foreground">
              Needs <code className="bg-secondary/60 px-1 rounded">Zone:DNS:Edit</code> permission on the target zones.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : mode === "add" ? "Add credential" : "Update credential"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCredentialDialog({
  credential,
  isPending,
  onConfirm,
  onClose
}: {
  credential: CloudflareCredential;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete credential</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          Delete <span className="font-medium text-foreground">"{credential.name}"</span>? This will fail if any ACME certificates or imported DNS zones are using it.
        </p>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="outline" onClick={onConfirm} disabled={isPending} className="border-destructive text-destructive hover:bg-destructive/10">
            {isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportZonesDialog({
  credential,
  onClose
}: {
  credential: CloudflareCredential;
  onClose: () => void;
}) {
  const { error: toastError, success: toastSuccess } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const zonesQuery = useQuery({
    queryKey: ["cloudflare-zones", credential.id],
    queryFn: () => api<CloudflareZone[]>(`/api/cloudflare/credentials/${credential.id}/zones`),
    retry: false
  });

  const importMutation = useMutation({
    mutationFn: (zoneNames: string[]) =>
      api<{ imported: number }>(`/api/cloudflare/credentials/${credential.id}/zones/import`, {
        method: "POST",
        body: JSON.stringify({ zoneNames })
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dns-dashboard"] });
      toastSuccess(`${data.imported} zone${data.imported === 1 ? "" : "s"} imported`);
      onClose();
    },
    onError: (err) => toastError("Import failed", humanizeError(err))
  });

  const zones = zonesQuery.data ?? [];
  const importable = zones.filter((z) => !z.alreadyImported);
  const allSelected = importable.length > 0 && importable.every((z) => selected.has(z.name));

  // Pre-select zones that need upgrade (forward → local) when the list first loads
  useEffect(() => {
    if (!zonesQuery.isSuccess) return;
    const upgradeable = importable.filter((z) => z.needsUpgrade).map((z) => z.name);
    if (upgradeable.length > 0) setSelected(new Set(upgradeable));
  }, [zonesQuery.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(importable.map((z) => z.name)));
    }
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Cloudflare zones</DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-3">
          <p className="text-sm text-muted-foreground">
            Select which zones from <span className="font-medium text-foreground">{credential.name}</span> to manage locally in the DNS system.
          </p>

          {zonesQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Fetching zones from Cloudflare…</p>
          )}

          {zonesQuery.isError && (
            <p className="text-sm text-destructive">{humanizeError(zonesQuery.error)}</p>
          )}

          {zonesQuery.isSuccess && zones.length === 0 && (
            <p className="text-sm text-muted-foreground">No zones found for this credential.</p>
          )}

          {zonesQuery.isSuccess && zones.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              {importable.length > 1 && (
                <label className="flex items-center gap-3 px-4 py-2.5 bg-secondary/40 border-b border-border cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Select all</span>
                </label>
              )}
              <ul className="max-h-64 overflow-y-auto divide-y divide-border/60">
                {zones.map((zone) => (
                  <li key={zone.id}>
                    <label className={`flex items-center gap-3 px-4 py-2.5 ${zone.alreadyImported ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-secondary/20"}`}>
                      <input
                        type="checkbox"
                        disabled={zone.alreadyImported}
                        checked={zone.alreadyImported || selected.has(zone.name)}
                        onChange={() => !zone.alreadyImported && toggle(zone.name)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="text-sm flex-1">{zone.name}</span>
                      {zone.alreadyImported && (
                        <span className="text-xs text-muted-foreground">already local</span>
                      )}
                      {zone.needsUpgrade && (
                        <span className="text-xs text-amber-500">was forward — select to fix</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={importMutation.isPending}>Cancel</Button>
          <Button
            onClick={() => importMutation.mutate(Array.from(selected))}
            disabled={selected.size === 0 || importMutation.isPending}
          >
            {importMutation.isPending ? "Importing…" : `Import ${selected.size > 0 ? selected.size : ""} zone${selected.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Cloudflare icon (inline SVG) ─────────────────────────────────────────────

function CloudflareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M16.5 15.75c.3-1.05.15-2.025-.45-2.775-.6-.675-1.5-1.125-2.55-1.2l-8.25-.075c-.075 0-.15-.075-.225-.15-.075-.075-.075-.225 0-.3l.225-.375c.375-.675 1.125-1.125 1.95-1.125h.375c.225 0 .375-.15.45-.375C8.55 7.5 10.2 6 12.225 6c1.2 0 2.325.525 3.075 1.425.15.225.45.3.675.225A2.7 2.7 0 0 1 17.1 7.5c1.5 0 2.7 1.2 2.7 2.7 0 .3-.075.6-.15.9-.075.225.075.45.3.525 1.05.375 1.8 1.35 1.8 2.55 0 1.5-1.2 2.7-2.7 2.7H8.4c-.225 0-.375-.15-.375-.375V16.05c0-.225.15-.375.375-.375h8.025c.225 0 .375-.15.45-.375l.075-.375c0-.075 0-.15-.075-.15h-.375c-.225 0-.375-.15-.375-.375v-.075l-.075.375z"/>
    </svg>
  );
}
