import type { BlocklistEntry, DatabaseContext } from "../types.js";
import { boolValue, mapRecord, mapRows, placeholder, resolveInsertedId } from "./helpers.js";

export type NewBlocklistEntry = Omit<BlocklistEntry, "id" | "createdAt" | "updatedAt">;

export class BlocklistRepository {
  constructor(private readonly db: DatabaseContext) {}

  async getById(id: number) {
    const row = await this.db.get<BlocklistEntry & Record<string, unknown>>(
      `SELECT
        id,
        pattern,
        kind,
        source,
        enabled,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM blocklist_entries
      WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
    return mapRecord(row);
  }

  async list(): Promise<BlocklistEntry[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        id,
        pattern,
        kind,
        source,
        enabled,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM blocklist_entries
      ORDER BY pattern ASC`
    );
    return mapRows(rows) as unknown as BlocklistEntry[];
  }

  async create(input: NewBlocklistEntry) {
    const now = new Date().toISOString();
    const values = [input.pattern, input.kind, input.source, boolValue(input.enabled, this.db), now, now];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO blocklist_entries (
        pattern, kind, source, enabled, created_at, updated_at
      ) VALUES (${markers})${returning}`,
      values
    );

    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id));
  }

  async update(id: number, input: NewBlocklistEntry) {
    const now = new Date().toISOString();
    const values = [
      input.pattern,
      input.kind,
      input.source,
      boolValue(input.enabled, this.db),
      now,
      id
    ];
    await this.db.run(
      `UPDATE blocklist_entries
      SET
        pattern = ${placeholder(1, this.db)},
        kind = ${placeholder(2, this.db)},
        source = ${placeholder(3, this.db)},
        enabled = ${placeholder(4, this.db)},
        updated_at = ${placeholder(5, this.db)}
      WHERE id = ${placeholder(6, this.db)}`,
      values
    );
    return this.getById(id);
  }

  async delete(id: number) {
    const existing = await this.getById(id);
    if (!existing) {
      return null;
    }
    await this.db.run(`DELETE FROM blocklist_entries WHERE id = ${placeholder(1, this.db)}`, [id]);
    return existing;
  }
}
