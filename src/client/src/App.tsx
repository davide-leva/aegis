import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { AppShell } from "./components/layout/app-shell";
import { useWsInvalidation } from "./hooks/use-ws-invalidation";
import { isAuthenticated } from "./lib/auth";
import { ApiKeysPage } from "./pages/api-keys-page";
import { CertificatesPage } from "./pages/certificates-page";
import { DnsPage } from "./pages/dns-page";
import { DockerPage } from "./pages/docker-page";
import { LoginPage } from "./pages/login-page";
import { MappingsPage } from "./pages/mappings-page";
import { ProxyPage } from "./pages/proxy-page";
import { SetupPage } from "./pages/setup-page";
import { SettingsPage } from "./pages/settings-page";
import { SystemPage } from "./pages/system-page";

// ─── Auth status (first-run check) ────────────────────────────────────────────

type AuthStatus = { setupRequired: boolean; authenticated: boolean } | null;

function useAuthStatus() {
  const [status, setStatus] = useState<AuthStatus>(null);

  useEffect(() => {
    fetch("/api/auth/status", {
      headers: isAuthenticated() ? { Authorization: `Bearer ${localStorage.getItem("aegis_token")}` } : {}
    })
      .then((r) => r.json() as Promise<AuthStatus>)
      .then(setStatus)
      .catch(() => setStatus({ setupRequired: false, authenticated: false }));
  }, []);

  return status;
}

// ─── Guard: redirects unauthenticated users ────────────────────────────────────

function AuthGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (!isAuthenticated()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

// ─── Inner app (mounted only when authenticated) ──────────────────────────────

function AuthenticatedApp() {
  useWsInvalidation();

  return (
    <Routes>
      <Route path="/" element={<DnsPage />} />
      <Route path="/dns" element={<DnsPage />} />
      <Route path="/certificates" element={<CertificatesPage />} />
      <Route path="/proxy" element={<ProxyPage />} />
      <Route path="/docker/*" element={<DockerPage />} />
      <Route path="/mappings" element={<MappingsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/system" element={<SystemPage />} />
      <Route path="/api-keys" element={<ApiKeysPage />} />
      <Route
        path="/network"
        element={<PlaceholderPage title="Network Policy" description="LAN-wide policy controls and service exposure boundaries will be managed here." />}
      />
      <Route
        path="/audit"
        element={<PlaceholderPage title="Audit Trail" description="Operational events, resolver actions and provisioning history will be listed here." />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// ─── Root: decides which shell to show ────────────────────────────────────────

export function App() {
  const status = useAuthStatus();

  // While checking server status, show nothing to avoid flicker
  if (status === null) return null;

  return (
    <Routes>
      {/* First-run setup — accessible only when no users exist */}
      <Route
        path="/setup"
        element={status.setupRequired ? <SetupPage /> : <Navigate to="/" replace />}
      />

      {/* Login */}
      <Route
        path="/login"
        element={
          status.setupRequired
            ? <Navigate to="/setup" replace />
            : isAuthenticated()
              ? <Navigate to="/" replace />
              : <LoginPage />
        }
      />

      {/* All other routes require auth */}
      <Route
        path="*"
        element={
          status.setupRequired
            ? <Navigate to="/setup" replace />
            : <AuthGuard><AuthenticatedApp /></AuthGuard>
        }
      />
    </Routes>
  );
}

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <AppShell title={title} description={description}>
      <div className="rounded-md border border-dashed border-border bg-background/30 p-10 text-sm text-muted-foreground">
        This module is reserved in the navigation and will be implemented in the next project slices.
      </div>
    </AppShell>
  );
}
