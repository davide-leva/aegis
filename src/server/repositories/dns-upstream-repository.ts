import type { DatabaseContext, DnsUpstream } from "../types.js";
import { boolValue, mapRecord, mapRows, placeholder, resolveInsertedId } from "./helpers.js";

export type NewUpstream = Omit<DnsUpstream, "id" | "createdAt" | "updatedAt" | "healthStatus">;

export class DnsUpstreamRepository {
  constructor(private readonly db: DatabaseContext) {}

  async getById(id: number) {
    const row = await this.db.get<DnsUpstream & Record<string, unknown>>(
      `SELECT
        id,
        name,
        address,
        port,
        protocol,
        enabled,
        priority,
        health_status AS "healthStatus",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM dns_upstreams
      WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
    return mapRecord(row);
  }

  async list(): Promise<DnsUpstream[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        id,
        name,
        address,
        port,
        protocol,
        enabled,
        priority,
        health_status AS "healthStatus",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM dns_upstreams
      ORDER BY priority ASC, name ASC`
    );
    return mapRows(rows) as unknown as DnsUpstream[];
  }

  async create(input: NewUpstream) {
    const now = new Date().toISOString();
    const values = [
      input.name,
      input.address,
      input.port,
      input.protocol,
      boolValue(input.enabled, this.db),
      input.priority,
      "unknown",
      now,
      now
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO dns_upstreams (
        name, address, port, protocol, enabled, priority, health_status, created_at, updated_at
      ) VALUES (${markers})${returning}`,
      values
    );

    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id));
  }

  async update(id: number, input: NewUpstream) {
    const now = new Date().toISOString();
    const values = [
      input.name,
      input.address,
      input.port,
      input.protocol,
      boolValue(input.enabled, this.db),
      input.priority,
      now,
      id
    ];
    await this.db.run(
      `UPDATE dns_upstreams
      SET
        name = ${placeholder(1, this.db)},
        address = ${placeholder(2, this.db)},
        port = ${placeholder(3, this.db)},
        protocol = ${placeholder(4, this.db)},
        enabled = ${placeholder(5, this.db)},
        priority = ${placeholder(6, this.db)},
        updated_at = ${placeholder(7, this.db)}
      WHERE id = ${placeholder(8, this.db)}`,
      values
    );
    return this.getById(id);
  }

  async delete(id: number) {
    const existing = await this.getById(id);
    if (!existing) {
      return null;
    }
    await this.db.run(`DELETE FROM dns_upstreams WHERE id = ${placeholder(1, this.db)}`, [id]);
    return existing;
  }
}
