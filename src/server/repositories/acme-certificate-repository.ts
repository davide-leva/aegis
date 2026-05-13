import type { AcmeCertificate, DatabaseContext } from "../types.js";
import { boolValue, mapRecord, parseJsonArray, placeholder, resolveInsertedId } from "./helpers.js";

export type NewAcmeCertificate = Omit<AcmeCertificate,
  "id" | "createdAt" | "updatedAt" | "acmeAccountName" | "cloudflareCredentialName"
>;

const parseDomains = (value: unknown) => parseJsonArray(value);

function mapRow(row: (AcmeCertificate & Record<string, unknown>) | undefined): AcmeCertificate | undefined {
  const mapped = mapRecord(row);
  if (!mapped) return undefined;
  return { ...mapped, domains: parseDomains(mapped.domains) } as AcmeCertificate;
}

const SELECT_SQL = `
  SELECT
    cert.id,
    cert.name,
    cert.acme_account_id AS "acmeAccountId",
    acc.name AS "acmeAccountName",
    cert.cloudflare_credential_id AS "cloudflareCredentialId",
    cf.name AS "cloudflareCredentialName",
    cert.domains,
    cert.certificate_pem AS "certificatePem",
    cert.private_key_pem AS "privateKeyPem",
    cert.chain_pem AS "chainPem",
    cert.serial_number AS "serialNumber",
    cert.issued_at AS "issuedAt",
    cert.expires_at AS "expiresAt",
    cert.renewal_days AS "renewalDays",
    cert.active,
    cert.created_at AS "createdAt",
    cert.updated_at AS "updatedAt"
  FROM acme_certificates cert
  INNER JOIN acme_accounts acc ON acc.id = cert.acme_account_id
  INNER JOIN cloudflare_credentials cf ON cf.id = cert.cloudflare_credential_id
`;

export class AcmeCertificateRepository {
  constructor(private readonly db: DatabaseContext) {}

  async getById(id: number): Promise<AcmeCertificate | undefined> {
    const row = await this.db.get<AcmeCertificate & Record<string, unknown>>(
      `${SELECT_SQL} WHERE cert.id = ${placeholder(1, this.db)}`,
      [id]
    );
    return mapRow(row);
  }

  async list(): Promise<AcmeCertificate[]> {
    const rows = await this.db.all<AcmeCertificate & Record<string, unknown>>(
      `${SELECT_SQL} ORDER BY cert.name ASC`
    );
    return rows.map((row) => mapRow(row)!);
  }

  async create(input: NewAcmeCertificate): Promise<AcmeCertificate> {
    const now = new Date().toISOString();
    const domainsJson = JSON.stringify(input.domains);
    const values = [
      input.name, input.acmeAccountId, input.cloudflareCredentialId, domainsJson,
      input.certificatePem, input.privateKeyPem, input.chainPem, input.serialNumber,
      input.issuedAt, input.expiresAt, input.renewalDays,
      boolValue(input.active, this.db), now, now
    ];
    const markers = values.map((_, i) => placeholder(i + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO acme_certificates
         (name, acme_account_id, cloudflare_credential_id, domains,
          certificate_pem, private_key_pem, chain_pem, serial_number,
          issued_at, expires_at, renewal_days, active, created_at, updated_at)
       VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id)) as Promise<AcmeCertificate>;
  }

  async updateMaterial(
    id: number,
    input: Pick<NewAcmeCertificate, "certificatePem" | "privateKeyPem" | "chainPem" | "serialNumber" | "issuedAt" | "expiresAt">
  ): Promise<AcmeCertificate | undefined> {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE acme_certificates
       SET certificate_pem = ${placeholder(1, this.db)},
           private_key_pem = ${placeholder(2, this.db)},
           chain_pem = ${placeholder(3, this.db)},
           serial_number = ${placeholder(4, this.db)},
           issued_at = ${placeholder(5, this.db)},
           expires_at = ${placeholder(6, this.db)},
           updated_at = ${placeholder(7, this.db)}
       WHERE id = ${placeholder(8, this.db)}`,
      [input.certificatePem, input.privateKeyPem, input.chainPem,
       input.serialNumber, input.issuedAt, input.expiresAt, now, id]
    );
    return this.getById(id);
  }

  async delete(id: number): Promise<AcmeCertificate | undefined> {
    const existing = await this.getById(id);
    if (!existing) return undefined;
    await this.db.run(`DELETE FROM acme_certificates WHERE id = ${placeholder(1, this.db)}`, [id]);
    return existing;
  }
}
