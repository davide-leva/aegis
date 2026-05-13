import crypto from "node:crypto";

import type { ApiKey, ApiScope, DatabaseContext } from "../types.js";
import { parseJsonArray, placeholder, resolveInsertedId } from "./helpers.js";

export function generateApiKey(): { plaintext: string; hash: string } {
  const bytes = crypto.randomBytes(32);
  const plaintext = "aegis_" + bytes.toString("hex");
  const hash = crypto.createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

export function hashApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

const parseScopes = (value: unknown) => parseJsonArray<ApiScope>(value);

export class ApiKeyRepository {
  constructor(private readonly db: DatabaseContext) {}

  async findByHash(hash: string): Promise<ApiKey | undefined> {
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT id, name, key_hash AS "keyHash", scopes, created_by AS "createdBy",
              expires_at AS "expiresAt", last_used_at AS "lastUsedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM api_keys WHERE key_hash = ${placeholder(1, this.db)}`,
      [hash]
    );
    if (!row) return undefined;
    return { ...row, scopes: parseScopes(row.scopes) } as ApiKey;
  }

  async list(userId: number): Promise<Omit<ApiKey, "keyHash">[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT id, name, scopes, created_by AS "createdBy",
              expires_at AS "expiresAt", last_used_at AS "lastUsedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM api_keys WHERE created_by = ${placeholder(1, this.db)}
       ORDER BY created_at DESC`,
      [userId]
    );
    return rows.map((row) => ({ ...row, scopes: parseScopes(row.scopes) })) as Omit<ApiKey, "keyHash">[];
  }

  async create(input: {
    name: string;
    scopes: ApiScope[];
    createdBy: number;
    expiresAt: string | null;
    keyHash: string;
  }): Promise<ApiKey> {
    const now = new Date().toISOString();
    const scopesJson = JSON.stringify(input.scopes);
    const values = [input.name, input.keyHash, scopesJson, input.createdBy, input.expiresAt, now, now];
    const markers = values.map((_, i) => placeholder(i + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO api_keys (name, key_hash, scopes, created_by, expires_at, created_at, updated_at)
       VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT id, name, key_hash AS "keyHash", scopes, created_by AS "createdBy",
              expires_at AS "expiresAt", last_used_at AS "lastUsedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM api_keys WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
    return { ...row!, scopes: parseScopes(row!.scopes) } as ApiKey;
  }

  async delete(id: number): Promise<void> {
    await this.db.run(`DELETE FROM api_keys WHERE id = ${placeholder(1, this.db)}`, [id]);
  }

  async updateLastUsed(id: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE api_keys SET last_used_at = ${placeholder(1, this.db)}, updated_at = ${placeholder(2, this.db)}
       WHERE id = ${placeholder(3, this.db)}`,
      [now, now, id]
    );
  }
}
