import type { ReactNode } from "react";
import {
  Boxes,
  FileKey2,
  Globe2,
  Network,
  Shield,
  ShieldCheck,
  Waypoints
} from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

interface AppShellProps {
  title: string;
  description: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}

const navigation = [
  { to: "/dns", label: "DNS", icon: Globe2, available: true },
  { to: "/certificates", label: "CA & Certificates", icon: FileKey2, available: true },
  { to: "/proxy", label: "Proxy", icon: ShieldCheck, available: true },
  { to: "/docker", label: "Docker Discovery", icon: Boxes, available: true },
  { to: "/network", label: "Network Policy", icon: Network, available: false },
  { to: "/audit", label: "Audit Trail", icon: Waypoints, available: false }
];

export function AppShell({ title, description, eyebrow = "Aegis Control Plane", actions, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className="p-3 lg:h-screen lg:overflow-hidden lg:p-4">
        <div className="gap-4 lg:grid lg:h-[calc(100vh-2rem)] lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flex flex-col rounded-xl border border-border bg-card/75 p-4 shadow-panel backdrop-blur lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:p-5">
          <div className="flex items-start gap-3 border-b border-border pb-4">
            <div className="rounded-md border border-primary/20 bg-primary/10 p-2">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Aegis</p>
              <h1 className="mt-1 text-lg font-semibold text-foreground">Enterprise LAN Services</h1>
              <p className="mt-1 text-sm text-muted-foreground">DNS first, then certificates, proxy and container activation flows.</p>
            </div>
          </div>

          <nav className="mt-6 flex-1 space-y-1">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center justify-between rounded-md px-3 py-3 text-sm transition-colors",
                    item.available ? "hover:bg-secondary/70" : "cursor-default opacity-65",
                    isActive && item.available ? "bg-secondary text-foreground" : "text-muted-foreground"
                  )
                }
                onClick={(event) => {
                  if (!item.available) {
                    event.preventDefault();
                  }
                }}
              >
                <span className="flex items-center gap-3">
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </span>
                {!item.available ? (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                    Soon
                  </span>
                ) : null}
              </NavLink>
            ))}
          </nav>

          <div className="mt-6 rounded-md border border-border bg-background/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Roadmap</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The DNS slice is live. The next surfaces are certificate issuance, reverse proxy publication and container onboarding.
            </p>
          </div>
        </aside>

          <main className="mt-4 min-w-0 space-y-8 rounded-xl border border-border bg-card/60 px-4 py-4 shadow-panel backdrop-blur lg:mt-0 lg:h-[calc(100vh-2rem)] lg:overflow-auto lg:px-8 lg:py-6 2xl:px-10">
            <header className="flex flex-col gap-4 border-b border-border pb-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h2>
                <p className="mt-2 max-w-5xl text-sm leading-6 text-muted-foreground">{description}</p>
              </div>
            </div>
            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </header>

          {children}
          </main>
        </div>
      </div>
    </div>
  );
}
