import type { DatabaseContext, DomainEvent, EventTopic } from "../types.js";
import { placeholder, resolveInsertedId } from "./helpers.js";

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
    return this.db.get<DomainEvent & Record<string, unknown>>(
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
  }
}
