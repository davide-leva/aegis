import type { DatabaseContext, DomainEvent, EventTopic } from "../types.js";
import { placeholder, resolveInsertedId } from "./helpers.js";

const ansi = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  gray: "\x1b[90m"
} as const;

function prettyFields(value: unknown, prefix = ""): string[] {
  if (value == null) {
    return [`${ansi.gray}${prefix || "value"}: null${ansi.reset}`];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${ansi.gray}${prefix || "items"}: none${ansi.reset}`];
    }
    return value.flatMap((entry, index) => prettyFields(entry, prefix ? `${prefix}[${index}]` : `[${index}]`));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return [`${ansi.gray}${prefix || "value"}: empty${ansi.reset}`];
    }
    return entries.flatMap(([key, entry]) => prettyFields(entry, prefix ? `${prefix}.${key}` : key));
  }

  return [`${ansi.gray}${prefix || "value"}: ${String(value)}${ansi.reset}`];
}

function describeEvent(topic: string, payload: Record<string, unknown>): string {
  const s = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  const arr = (k: string) => (Array.isArray(payload[k]) ? (payload[k] as string[]).join(", ") : s(k));
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
    case "dns.runtime.restarted": return "DNS worker restarted";
    case "dns.runtime.exited": return "DNS worker exited";
    case "dns.runtime.error": return `DNS worker error: ${s("error") || s("message") || "unknown"}`;
    case "proxy.route.created": return `Proxy route "${s("name")}" created (${s("protocol")})`;
    case "proxy.route.updated": return `Proxy route "${s("name")}" updated`;
    case "proxy.route.deleted": return `Proxy route "${s("name")}" deleted`;
    case "proxy.runtime.started": return "Proxy worker started";
    case "proxy.runtime.restarted": return "Proxy worker restarted";
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
    case "docker.mapping.deleted": return "Docker port mapping deleted";
    case "acme.certificate.issued": return `ACME certificate "${s("name")}" issued for ${arr("domains")}`;
    case "acme.certificate.renewed": return `ACME certificate "${s("name")}" renewed`;
    case "acme.certificate.deleted": return `ACME certificate "${s("name")}" deleted`;
    default: return topic;
  }
}

function logDomainEvent(event: DomainEvent & Record<string, unknown>) {
  const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
  const description = describeEvent(event.topic, payload as Record<string, unknown>);

  process.stdout.write(
    [
      `${ansi.dim}${event.createdAt}${ansi.reset} ${ansi.cyan}EVENT${ansi.reset} ${ansi.magenta}${event.topic}${ansi.reset}`,
      `${ansi.green}${description}${ansi.reset}`,
      `${ansi.dim}${event.aggregateType}#${event.aggregateId} (id=${event.id})${ansi.reset}`,
      ""
    ].join("\n")
  );
}

export class EventRepository {
  constructor(private readonly db: DatabaseContext) {}

  async list(options: { limit?: number; offset?: number; topicPrefix?: string } = {}): Promise<DomainEvent[]> {
    const { limit = 100, offset = 0, topicPrefix } = options;
    const params: unknown[] = [];

    let where = "";
    if (topicPrefix) {
      params.push(`${topicPrefix}%`);
      where = `WHERE topic LIKE ${placeholder(params.length, this.db)}`;
    }

    params.push(limit);
    const limitPH = placeholder(params.length, this.db);
    params.push(offset);
    const offsetPH = placeholder(params.length, this.db);

    const rows = await this.db.all<DomainEvent & Record<string, unknown>>(
      `SELECT
        id,
        topic,
        aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId",
        payload,
        metadata,
        created_at AS "createdAt"
      FROM domain_events
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limitPH} OFFSET ${offsetPH}`,
      params
    );
    return rows;
  }

  async count(topicPrefix?: string): Promise<number> {
    const params: unknown[] = [];
    let where = "";
    if (topicPrefix) {
      params.push(`${topicPrefix}%`);
      where = `WHERE topic LIKE ${placeholder(1, this.db)}`;
    }
    const row = await this.db.get<{ total: number }>(
      `SELECT COUNT(*) as total FROM domain_events ${where}`,
      params
    );
    return Number(row?.total ?? 0);
  }

  async create(input: {
    topic: EventTopic;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    metadata?: Record<string, unknown> | null;
  }) {
    const now = new Date().toISOString();
    const values = [
      input.topic,
      input.aggregateType,
      input.aggregateId,
      JSON.stringify(input.payload),
      input.metadata ? JSON.stringify(input.metadata) : null,
      now
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO domain_events (
        topic, aggregate_type, aggregate_id, payload, metadata, created_at
      ) VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    const event = await this.db.get<DomainEvent & Record<string, unknown>>(
      `SELECT
        id,
        topic,
        aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId",
        payload,
        metadata,
        created_at AS "createdAt"
      FROM domain_events
      WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
    if (event) {
      logDomainEvent(event);
    }
    return event;
  }
}
