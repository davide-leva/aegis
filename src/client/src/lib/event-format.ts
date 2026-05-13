export function formatEventPayload(payload: string) {
  try {
    return formatValue(JSON.parse(payload));
  } catch {
    return payload;
  }
}

function formatValue(value: unknown, prefix = ""): string {
  if (value == null) {
    return `${prefix || "value"}: null`;
  }
  if (Array.isArray(value)) {
    return value.length === 0
      ? `${prefix || "items"}: none`
      : value.map((entry, index) => formatValue(entry, prefix ? `${prefix}[${index}]` : `[${index}]`)).join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${prefix || "value"}: empty`;
    }
    return entries.map(([key, entry]) => formatValue(entry, prefix ? `${prefix}.${key}` : key)).join("\n");
  }
  return `${prefix || "value"}: ${String(value)}`;
}

export type EventSeverity = "info" | "success" | "warning" | "error";

export function eventSeverity(topic: string): EventSeverity {
  if (topic.endsWith(".error") || topic === "docker.mapping.automap_failed") return "error";
  if (topic.endsWith(".exited") || topic.endsWith(".deleted")) return "warning";
  if (topic.endsWith(".restarted")) return "warning";
  if (
    topic.endsWith(".created") ||
    topic.endsWith(".started") ||
    topic.endsWith(".completed") ||
    topic.endsWith(".issued") ||
    topic.endsWith(".automapped")
  ) return "success";
  return "info";
}

export function humanizeEvent(topic: string, payloadJson: string): string {
  try {
    const p = JSON.parse(payloadJson) as Record<string, unknown>;
    const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
    const arr = (k: string) => (Array.isArray(p[k]) ? (p[k] as string[]).join(", ") : s(k));

    switch (topic) {
      case "dns.bootstrap.completed": return "DNS configuration bootstrap completed";
      case "dns.zone.created": return `DNS zone "${s("name")}" created`;
      case "dns.zone.updated": return `DNS zone "${s("name")}" updated`;
      case "dns.zone.deleted": return `DNS zone "${s("name")}" deleted`;
      case "dns.record.created": return `DNS record "${s("name")}" (${s("type")}) created`;
      case "dns.record.updated": return `DNS record "${s("name")}" updated`;
      case "dns.record.deleted": return `DNS record "${s("name")}" deleted`;
      case "dns.upstream.created": return `Upstream resolver "${s("name")}" added (${s("address")})`;
      case "dns.upstream.updated": return `Upstream resolver "${s("name")}" updated`;
      case "dns.upstream.deleted": return `Upstream resolver "${s("name")}" removed`;
      case "dns.blocklist.created": return `DNS blocklist "${s("name") || s("pattern")}" added`;
      case "dns.blocklist.updated": return `DNS blocklist "${s("name") || s("pattern")}" updated`;
      case "dns.blocklist.deleted": return `DNS blocklist "${s("name") || s("pattern")}" removed`;
      case "dns.runtime.started": return "DNS worker started";
      case "dns.runtime.restarted": return `DNS worker restarted`;
      case "dns.runtime.exited": return "DNS worker exited";
      case "dns.runtime.error": return `DNS worker error: ${s("error") || s("message") || "unknown"}`;
      case "proxy.route.created": return `Proxy route "${s("name")}" created (${s("protocol")})`;
      case "proxy.route.updated": return `Proxy route "${s("name")}" updated`;
      case "proxy.route.deleted": return `Proxy route "${s("name")}" deleted`;
      case "proxy.runtime.started": return "Proxy worker started";
      case "proxy.runtime.restarted": return `Proxy worker restarted`;
      case "proxy.runtime.exited": return "Proxy worker exited";
      case "proxy.runtime.error": return `Proxy worker error: ${s("error") || s("message") || "unknown"}`;
      case "certificate.subject.created": return `Certificate subject "${s("name")}" created`;
      case "certificate.subject.updated": return `Certificate subject "${s("name")}" updated`;
      case "certificate.subject.deleted": return `Certificate subject "${s("name")}" deleted`;
      case "certificate.ca.created": return `Certificate authority "${s("name")}" created`;
      case "certificate.ca.defaulted": return `Certificate authority "${s("name")}" set as default`;
      case "certificate.server.created": return `Server certificate "${s("name")}" issued`;
      case "certificate.server.renewed": return `Server certificate "${s("name")}" renewed`;
      case "certificate.server.deleted": return `Server certificate "${s("name")}" deleted`;
      case "docker.environment.created": return `Docker environment "${s("name")}" added`;
      case "docker.environment.updated": return `Docker environment "${s("name")}" updated`;
      case "docker.environment.deleted": return `Docker environment "${s("name")}" removed`;
      case "docker.mapping.created": return `Docker port mapping for "${s("containerName")}" created`;
      case "docker.mapping.automapped": return `Container "${s("containerName")}" auto-mapped`;
      case "docker.mapping.automap_failed": return `Auto-mapping failed for "${s("containerName")}": ${s("error")}`;
      case "docker.mapping.deleted": return `Docker port mapping deleted`;
      case "acme.certificate.issued": return `ACME certificate "${s("name")}" issued for ${arr("domains")}`;
      case "acme.certificate.renewed": return `ACME certificate "${s("name")}" renewed`;
      case "acme.certificate.deleted": return `ACME certificate "${s("name")}" deleted`;
      default: return topic;
    }
  } catch {
    return topic;
  }
}
