import type { AuditContext, AuditLogEntry, AuditAction, DatabaseContext } from "../types.js";
import { placeholder, resolveInsertedId } from "./helpers.js";

export class AuditRepository {
  constructor(private readonly db: DatabaseContext) {}

  async list(limit = 100): Promise<AuditLogEntry[]> {
    const rows = await this.db.all<AuditLogEntry & Record<string, unknown>>(
      `SELECT
        id,
        action,
        entity_type AS "entityType",
        entity_id AS "entityId",
        actor_type AS "actorType",
        actor_id AS "actorId",
        source_ip AS "sourceIp",
        user_agent AS "userAgent",
        payload,
        created_at AS "createdAt"
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT ${placeholder(1, this.db)}`,
      [limit]
    );
    return rows;
  }

  async create(input: {
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    payload?: Record<string, unknown> | null;
    context: AuditContext;
  }) {
    const now = new Date().toISOString();
    const values = [
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.context.actorType,
      input.context.actorId,
      input.context.sourceIp,
      input.context.userAgent,
      input.payload ? JSON.stringify(input.payload) : null,
      now
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO audit_logs (
        action, entity_type, entity_id, actor_type, actor_id, source_ip, user_agent, payload, created_at
      ) VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.db.get<AuditLogEntry & Record<string, unknown>>(
      `SELECT
        id,
        action,
        entity_type AS "entityType",
        entity_id AS "entityId",
        actor_type AS "actorType",
        actor_id AS "actorId",
        source_ip AS "sourceIp",
        user_agent AS "userAgent",
        payload,
        created_at AS "createdAt"
      FROM audit_logs
      WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
  }
}
