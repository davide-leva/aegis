import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Copy, KeyRound, Plus, Trash2 } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { humanizeError } from "@/lib/errors";

// ─── Types ────────────────────────────────────────────────────────────────────

type ApiKey = {
  id: number;
  name: string;
  scopes: string[];
  createdBy: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreateApiKeyResponse = ApiKey & { key: string };

// ─── Scope configuration ───────────────────────────────────────────────────

const SCOPE_GROUPS = [
  { label: "Admin", scopes: [{ value: "admin", label: "Full admin access" }] },
  { label: "DNS", scopes: [{ value: "dns:read", label: "Read" }, { value: "dns:write", label: "Write" }] },
  { label: "Proxy", scopes: [{ value: "proxy:read", label: "Read" }, { value: "proxy:write", label: "Write" }] },
  { label: "Docker", scopes: [{ value: "docker:read", label: "Read" }, { value: "docker:write", label: "Write" }] },
  {
    label: "Certificates & ACME",
    scopes: [{ value: "ca:read", label: "Read" }, { value: "ca:write", label: "Write" }]
  }
] as const;

type ApiKeyForm = {
  name: string;
  expiresAt: string;
  scopes: Record<string, boolean>;
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const { error: toastError } = useToast();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const keysQuery = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api<ApiKey[]>("/api/api-keys")
  });

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<ApiKeyForm>({
    defaultValues: { name: "", expiresAt: "", scopes: {} }
  });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; scopes: string[]; expiresAt: string | null }) =>
      api<CreateApiKeyResponse>("/api/api-keys", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      setCreatedKey(data.key);
      setCreateOpen(false);
      reset();
    },
    onError: (err) => toastError("Failed to create API key", humanizeError(err))
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api(`/api/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
    onError: (err) => toastError("Failed to delete API key", humanizeError(err))
  });

  const scopeValues = watch("scopes");

  function onSubmit(values: ApiKeyForm) {
    const scopes = Object.entries(values.scopes)
      .filter(([, enabled]) => enabled)
      .map(([scope]) => scope);
    if (scopes.length === 0) return;
    createMutation.mutate({
      name: values.name,
      scopes,
      expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null
    });
  }

  const keys = keysQuery.data ?? [];

  return (
    <AppShell
      title="API Keys"
      description="Issue long-lived tokens for automation and integrations. Scopes restrict what each key can do."
      actions={
        <>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" />
                New API key
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>
                  The key is shown only once immediately after creation. Store it securely.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input placeholder="e.g. CI/CD pipeline" {...register("name", { required: "Name is required", minLength: { value: 2, message: "Must be at least 2 characters" }, maxLength: { value: 120, message: "Max 120 characters" } })} />
                  {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label>Expires (optional)</Label>
                  <Input type="date" {...register("expiresAt")} />
                </div>

                <div className="space-y-3">
                  <Label>Scopes</Label>
                  <div className="space-y-3 rounded-md border border-border p-3">
                    {SCOPE_GROUPS.map((group) => (
                      <div key={group.label}>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {group.label}
                        </p>
                        <div className="flex flex-wrap gap-x-6 gap-y-2">
                          {group.scopes.map((scope) => (
                            <label key={scope.value} className="flex cursor-pointer items-center gap-2 text-sm">
                              <Switch
                                checked={!!scopeValues[scope.value]}
                                onCheckedChange={(v) => setValue(`scopes.${scope.value}`, v)}
                              />
                              {scope.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {Object.values(scopeValues).every((v) => !v) && (
                    <p className="text-xs text-red-500">Select at least one scope.</p>
                  )}
                </div>

                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating…" : "Create key"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </>
      }
    >
      {/* Key reveal dialog (shown once after creation) */}
      <Dialog open={!!createdKey} onOpenChange={(open) => { if (!open) { setCreatedKey(null); setCopied(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API key created</DialogTitle>
            <DialogDescription>
              Copy this key now — it will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/60 px-3 py-2">
              <code className="flex-1 break-all font-mono text-xs">{createdKey}</code>
              <Button
                variant="ghost"
                className="h-7 w-7 shrink-0 p-0"
                onClick={() => {
                  navigator.clipboard.writeText(createdKey ?? "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <CheckSquare className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setCreatedKey(null); setCopied(false); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
        <div className="grid gap-4 xl:grid-cols-3">
          <MetricCard icon={KeyRound} label="Total keys" value={keys.length} detail="active API credentials" />
          <MetricCard
            icon={KeyRound}
            label="Expiring soon"
            value={keys.filter((k) => k.expiresAt && daysUntil(k.expiresAt) <= 7).length}
            detail="within 7 days"
          />
          <MetricCard
            icon={KeyRound}
            label="Never expire"
            value={keys.filter((k) => !k.expiresAt).length}
            detail="no expiry set"
          />
        </div>

        <Card className="bg-background/20">
          <CardHeader>
            <CardTitle>Keys</CardTitle>
            <CardDescription>Each key can only be viewed once at creation time.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {keysQuery.isLoading ? (
              <p className="px-6 py-8 text-sm text-muted-foreground">Loading…</p>
            ) : keys.length === 0 ? (
              <p className="px-6 py-8 text-sm italic text-muted-foreground">No API keys yet.</p>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  <tr>
                    {["Name", "Scopes", "Last used", "Expires", "Created", ""].map((h) => (
                      <th key={h} className="border-b border-border px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3 font-medium">{key.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {key.scopes.map((scope) => (
                            <Badge key={scope} variant="default" className="font-mono text-[10px]">
                              {scope}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {key.lastUsedAt ? formatDate(key.lastUsedAt) : "Never"}
                      </td>
                      <td className="px-4 py-3">
                        {key.expiresAt ? (
                          <Badge variant={daysUntil(key.expiresAt) <= 7 ? "danger" : "muted"}>
                            {formatDate(key.expiresAt)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Never</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(key.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <DeleteApiKeyDialog
                            name={key.name}
                            loading={deleteMutation.isPending}
                            onConfirm={() => deleteMutation.mutate(key.id)}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

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
      <CardContent className="flex items-center gap-4 pt-5">
        <div className="rounded-md border border-border bg-secondary/50 p-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-xs text-muted-foreground/60">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteApiKeyDialog({
  name,
  loading,
  onConfirm
}: {
  name: string;
  loading: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete API key</DialogTitle>
          <DialogDescription>
            The key <strong>{name}</strong> will be permanently revoked. Any integrations using it will stop working.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            disabled={loading}
            onClick={() => { onConfirm(); setOpen(false); }}
          >
            {loading ? "Revoking…" : "Revoke key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000);
}
