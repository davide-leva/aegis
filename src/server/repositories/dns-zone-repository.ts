import type { DatabaseContext, DnsZone } from "../types.js";
import { boolValue, mapRecord, mapRows, placeholder, resolveInsertedId } from "./helpers.js";

export type NewZone = Omit<DnsZone, "id" | "createdAt" | "updatedAt">;

export class DnsZoneRepository {
  constructor(private readonly db: DatabaseContext) {}

  async getById(id: number) {
    const row = await this.db.get<DnsZone & Record<string, unknown>>(
      `SELECT
        id,
        name,
        kind,
        description,
        is_primary AS "isPrimary",
        is_reverse AS "isReverse",
        ttl,
        enabled,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM dns_zones
      WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
    return mapRecord(row);
  }

  async list(): Promise<DnsZone[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        id,
        name,
        kind,
        description,
        is_primary AS "isPrimary",
        is_reverse AS "isReverse",
        ttl,
        enabled,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM dns_zones
      ORDER BY name ASC`
    );
    return mapRows(rows) as unknown as DnsZone[];
  }

  async create(input: NewZone) {
    const now = new Date().toISOString();
    const values = [
      input.name,
      input.kind,
      input.description,
      boolValue(input.isPrimary, this.db),
      boolValue(input.isReverse, this.db),
      input.ttl,
      boolValue(input.enabled, this.db),
      now,
      now
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO dns_zones (
        name, kind, description, is_primary, is_reverse, ttl, enabled, created_at, updated_at
      ) VALUES (${markers})${returning}`,
      values
    );

    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id));
  }

  async update(id: number, input: NewZone) {
    const now = new Date().toISOString();
    const values = [
      input.name,
      input.kind,
      input.description,
      boolValue(input.isPrimary, this.db),
      boolValue(input.isReverse, this.db),
      input.ttl,
      boolValue(input.enabled, this.db),
      now,
      id
    ];
    await this.db.run(
      `UPDATE dns_zones
      SET
        name = ${placeholder(1, this.db)},
        kind = ${placeholder(2, this.db)},
        description = ${placeholder(3, this.db)},
        is_primary = ${placeholder(4, this.db)},
        is_reverse = ${placeholder(5, this.db)},
        ttl = ${placeholder(6, this.db)},
        enabled = ${placeholder(7, this.db)},
        updated_at = ${placeholder(8, this.db)}
      WHERE id = ${placeholder(9, this.db)}`,
      values
    );
    return this.getById(id);
  }

  async delete(id: number) {
    const existing = await this.getById(id);
    if (!existing) {
      return null;
    }
    await this.db.run(`DELETE FROM dns_zones WHERE id = ${placeholder(1, this.db)}`, [id]);
    return existing;
  }
}
