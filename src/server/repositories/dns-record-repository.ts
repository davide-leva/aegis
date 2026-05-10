import type { DatabaseContext, DnsRecord } from "../types.js";
import { boolValue, mapRecord, mapRows, placeholder, resolveInsertedId } from "./helpers.js";

export type NewRecord = Omit<DnsRecord, "id" | "createdAt" | "updatedAt">;
export type DnsRecordListItem = DnsRecord & { zoneName: string };

export class DnsRecordRepository {
  constructor(private readonly db: DatabaseContext) {}

  async getById(id: number) {
    const row = await this.db.get<DnsRecord & Record<string, unknown>>(
      `SELECT
        id,
        zone_id AS "zoneId",
        name,
        type,
        value,
        ttl,
        priority,
        proxied_service AS "proxiedService",
        enabled,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM dns_records
      WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
    return mapRecord(row);
  }

  async list(): Promise<DnsRecordListItem[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        r.id,
        r.zone_id AS "zoneId",
        z.name AS "zoneName",
        r.name,
        r.type,
        r.value,
        r.ttl,
        r.priority,
        r.proxied_service AS "proxiedService",
        r.enabled,
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt"
      FROM dns_records r
      INNER JOIN dns_zones z ON z.id = r.zone_id
      ORDER BY z.name ASC, r.name ASC`
    );
    return mapRows(rows) as unknown as DnsRecordListItem[];
  }

  async create(input: NewRecord) {
    const now = new Date().toISOString();
    const values = [
      input.zoneId,
      input.name,
      input.type,
      input.value,
      input.ttl,
      input.priority,
      input.proxiedService,
      boolValue(input.enabled, this.db),
      now,
      now
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO dns_records (
        zone_id, name, type, value, ttl, priority, proxied_service, enabled, created_at, updated_at
      ) VALUES (${markers})${returning}`,
      values
    );

    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id));
  }

  async update(id: number, input: NewRecord) {
    const now = new Date().toISOString();
    const values = [
      input.zoneId,
      input.name,
      input.type,
      input.value,
      input.ttl,
      input.priority,
      input.proxiedService,
      boolValue(input.enabled, this.db),
      now,
      id
    ];
    await this.db.run(
      `UPDATE dns_records
      SET
        zone_id = ${placeholder(1, this.db)},
        name = ${placeholder(2, this.db)},
        type = ${placeholder(3, this.db)},
        value = ${placeholder(4, this.db)},
        ttl = ${placeholder(5, this.db)},
        priority = ${placeholder(6, this.db)},
        proxied_service = ${placeholder(7, this.db)},
        enabled = ${placeholder(8, this.db)},
        updated_at = ${placeholder(9, this.db)}
      WHERE id = ${placeholder(10, this.db)}`,
      values
    );
    return this.getById(id);
  }

  async delete(id: number) {
    const existing = await this.getById(id);
    if (!existing) {
      return null;
    }
    await this.db.run(`DELETE FROM dns_records WHERE id = ${placeholder(1, this.db)}`, [id]);
    return existing;
  }
}
