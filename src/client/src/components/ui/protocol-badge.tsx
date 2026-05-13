import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/components/ui/badge";

const VARIANTS: Record<string, BadgeVariant> = {
  http: "default",
  https: "success",
  tcp: "warning",
  udp: "muted"
};

export function ProtocolBadge({ protocol }: { protocol: "http" | "https" | "tcp" | "udp" }) {
  return <Badge variant={VARIANTS[protocol] ?? "default"}>{protocol.toUpperCase()}</Badge>;
}
