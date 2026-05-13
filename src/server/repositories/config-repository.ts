import type { DatabaseContext } from "../types.js";
import { placeholder } from "./helpers.js";

export class ConfigRepository {
  constructor(private readonly db: DatabaseContext) {}

  async getGroup(groupId: string): Promise<Record<string, string>> {
    const rows = await this.db.all<{ key: string; value: string }>(
      `SELECT key, value FROM config WHERE group_id = ${placeholder(1, this.db)}`,
      [groupId]
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async get(groupId: string, key: string): Promise<string | undefined> {
    const row = await this.db.get<{ value: string }>(
      `SELECT value FROM config WHERE group_id = ${placeholder(1, this.db)} AND key = ${placeholder(2, this.db)}`,
      [groupId, key]
    );
    return row?.value;
  }

  async set(groupId: string, key: string, value: string): Promise<void> {
    const now = new Date().toISOString();
    if (this.db.driver === "postgres") {
      await this.db.run(
        `INSERT INTO config (group_id, key, value, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (group_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [groupId, key, value, now]
      );
    } else {
      await this.db.run(
        `INSERT INTO config (group_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (group_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [groupId, key, value, now]
      );
    }
  }

  async setGroup(groupId: string, values: Record<string, string>): Promise<void> {
    await this.db.transaction(async (trx) => {
      const repo = new ConfigRepository(trx);
      for (const [key, value] of Object.entries(values)) {
        await repo.set(groupId, key, value);
      }
    });
  }

  async deleteKey(groupId: string, key: string): Promise<void> {
    await this.db.run(
      `DELETE FROM config WHERE group_id = ${placeholder(1, this.db)} AND key = ${placeholder(2, this.db)}`,
      [groupId, key]
    );
  }
}
