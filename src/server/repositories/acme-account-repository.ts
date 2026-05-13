import type { AcmeAccount, DatabaseContext } from "../types.js";
import { placeholder, resolveInsertedId } from "./helpers.js";

export const ACME_DIRECTORY_URLS = {
  "letsencrypt-production": "https://acme-v02.api.letsencrypt.org/directory",
  "letsencrypt-staging": "https://acme-staging-v02.api.letsencrypt.org/directory",
  "zerossl": "https://acme.zerossl.com/v2/DV90"
} as const;

export class AcmeAccountRepository {
  constructor(private readonly db: DatabaseContext) {}

  async list(): Promise<AcmeAccount[]> {
    return this.db.all<AcmeAccount>(
      `SELECT id, name, email, directory_url AS "directoryUrl", account_key_pem AS "accountKeyPem",
              account_url AS "accountUrl", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM acme_accounts ORDER BY name ASC`
    );
  }

  async getById(id: number): Promise<AcmeAccount | undefined> {
    return this.db.get<AcmeAccount>(
      `SELECT id, name, email, directory_url AS "directoryUrl", account_key_pem AS "accountKeyPem",
              account_url AS "accountUrl", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM acme_accounts WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
  }

  async create(input: { name: string; email: string; directoryUrl: string; accountKeyPem: string; accountUrl: string }): Promise<AcmeAccount> {
    const now = new Date().toISOString();
    const values = [input.name, input.email, input.directoryUrl, input.accountKeyPem, input.accountUrl, now, now];
    const markers = values.map((_, i) => placeholder(i + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO acme_accounts (name, email, directory_url, account_key_pem, account_url, created_at, updated_at)
       VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id)) as Promise<AcmeAccount>;
  }

  async updateAccountUrl(id: number, accountUrl: string): Promise<void> {
    const p = (n: number) => placeholder(n, this.db);
    await this.db.run(
      `UPDATE acme_accounts SET account_url = ${p(1)}, updated_at = ${p(2)} WHERE id = ${p(3)}`,
      [accountUrl, new Date().toISOString(), id]
    );
  }

  async delete(id: number): Promise<void> {
    await this.db.run(`DELETE FROM acme_accounts WHERE id = ${placeholder(1, this.db)}`, [id]);
  }
}
