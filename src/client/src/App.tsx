import { Route, Routes } from "react-router-dom";

import { AppShell } from "./components/layout/app-shell";
import { CertificatesPage } from "./pages/certificates-page";
import { DnsPage } from "./pages/dns-page";
import { DockerPage } from "./pages/docker-page";
import { MappingsPage } from "./pages/mappings-page";
import { ProxyPage } from "./pages/proxy-page";
import { SystemPage } from "./pages/system-page";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<DnsPage />} />
      <Route path="/dns" element={<DnsPage />} />
      <Route path="/certificates" element={<CertificatesPage />} />
      <Route
        path="/proxy"
        element={<ProxyPage />}
      />
      <Route path="/docker/*" element={<DockerPage />} />
      <Route path="/mappings" element={<MappingsPage />} />
      <Route path="/system" element={<SystemPage />} />
      <Route
        path="/network"
        element={<PlaceholderPage title="Network Policy" description="LAN-wide policy controls and service exposure boundaries will be managed here." />}
      />
      <Route
        path="/audit"
        element={<PlaceholderPage title="Audit Trail" description="Operational events, resolver actions and provisioning history will be listed here." />}
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
