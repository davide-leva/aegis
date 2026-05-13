import type { CloudflareCredential, DatabaseContext } from "../types.js";
import { placeholder, resolveInsertedId } from "./helpers.js";

export class CloudflareCredentialRepository {
  constructor(private readonly db: DatabaseContext) {}

  async list(): Promise<CloudflareCredential[]> {
    return this.db.all<CloudflareCredential>(
      `SELECT id, name, api_token AS "apiToken", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM cloudflare_credentials ORDER BY name ASC`
    );
  }

  async getById(id: number): Promise<CloudflareCredential | undefined> {
    return this.db.get<CloudflareCredential>(
      `SELECT id, name, api_token AS "apiToken", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM cloudflare_credentials WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
  }

  async create(input: { name: string; apiToken: string }): Promise<CloudflareCredential> {
    const now = new Date().toISOString();
    const values = [input.name, input.apiToken, now, now];
    const markers = values.map((_, i) => placeholder(i + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO cloudflare_credentials (name, api_token, created_at, updated_at) VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id)) as Promise<CloudflareCredential>;
  }

  async update(id: number, input: { name: string; apiToken: string }): Promise<CloudflareCredential | undefined> {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE cloudflare_credentials
       SET name = ${placeholder(1, this.db)}, api_token = ${placeholder(2, this.db)}, updated_at = ${placeholder(3, this.db)}
       WHERE id = ${placeholder(4, this.db)}`,
      [input.name, input.apiToken, now, id]
    );
    return this.getById(id);
  }

  async delete(id: number): Promise<void> {
    await this.db.run(`DELETE FROM cloudflare_credentials WHERE id = ${placeholder(1, this.db)}`, [id]);
  }
}
