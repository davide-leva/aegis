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

function logDomainEvent(event: DomainEvent & Record<string, unknown>) {
  const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
  const metadata =
    typeof event.metadata === "string" ? JSON.parse(event.metadata) : (event.metadata ?? null);

  process.stdout.write(
    [
      `${ansi.dim}${event.createdAt}${ansi.reset} ${ansi.cyan}DOMAIN_EVENT${ansi.reset} ${ansi.magenta}${event.topic}${ansi.reset}`,
      `${ansi.yellow}${event.aggregateType}${ansi.reset}#${ansi.green}${event.aggregateId}${ansi.reset} ${ansi.dim}(id=${event.id})${ansi.reset}`,
      `${ansi.dim}payload${ansi.reset}`,
      ...prettyFields(payload),
      metadata ? `${ansi.dim}metadata${ansi.reset}` : null,
      ...(metadata ? prettyFields(metadata) : []),
      ""
    ]
      .filter(Boolean)
      .join("\n")
  );
}

export class EventRepository {
  constructor(private readonly db: DatabaseContext) {}

  async list(limit = 100): Promise<DomainEvent[]> {
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
      ORDER BY created_at DESC
      LIMIT ${placeholder(1, this.db)}`,
      [limit]
    );
    return rows;
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
