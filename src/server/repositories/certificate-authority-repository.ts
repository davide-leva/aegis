import type { CertificateAuthority, DatabaseContext } from "../types.js";
import { boolValue, mapRecord, mapRows, placeholder, resolveInsertedId } from "./helpers.js";

export type NewCertificateAuthority = Omit<
  CertificateAuthority,
  "id" | "createdAt" | "updatedAt" | "subjectName" | "issuerName" | "commonName"
>;

export class CertificateAuthorityRepository {
  constructor(private readonly db: DatabaseContext) {}

  async getById(id: number) {
    const row = await this.db.get<CertificateAuthority & Record<string, unknown>>(
      `SELECT
        ca.id,
        ca.name,
        ca.subject_id AS "subjectId",
        ca.issuer_ca_id AS "issuerCaId",
        subject.name AS "subjectName",
        issuer.name AS "issuerName",
        subject.common_name AS "commonName",
        ca.certificate_pem AS "certificatePem",
        ca.private_key_pem AS "privateKeyPem",
        ca.serial_number AS "serialNumber",
        ca.issued_at AS "issuedAt",
        ca.expires_at AS "expiresAt",
        ca.validity_days AS "validityDays",
        ca.path_length AS "pathLength",
        ca.is_self_signed AS "isSelfSigned",
        ca.is_default AS "isDefault",
        ca.active,
        ca.created_at AS "createdAt",
        ca.updated_at AS "updatedAt"
      FROM certificate_authorities ca
      INNER JOIN certificate_subjects subject ON subject.id = ca.subject_id
      LEFT JOIN certificate_authorities issuer ON issuer.id = ca.issuer_ca_id
      WHERE ca.id = ${placeholder(1, this.db)}`,
      [id]
    );
    return mapRecord(row);
  }

  async list(): Promise<CertificateAuthority[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        ca.id,
        ca.name,
        ca.subject_id AS "subjectId",
        ca.issuer_ca_id AS "issuerCaId",
        subject.name AS "subjectName",
        issuer.name AS "issuerName",
        subject.common_name AS "commonName",
        ca.certificate_pem AS "certificatePem",
        ca.private_key_pem AS "privateKeyPem",
        ca.serial_number AS "serialNumber",
        ca.issued_at AS "issuedAt",
        ca.expires_at AS "expiresAt",
        ca.validity_days AS "validityDays",
        ca.path_length AS "pathLength",
        ca.is_self_signed AS "isSelfSigned",
        ca.is_default AS "isDefault",
        ca.active,
        ca.created_at AS "createdAt",
        ca.updated_at AS "updatedAt"
      FROM certificate_authorities ca
      INNER JOIN certificate_subjects subject ON subject.id = ca.subject_id
      LEFT JOIN certificate_authorities issuer ON issuer.id = ca.issuer_ca_id
      ORDER BY ca.created_at DESC, ca.name ASC`
    );
    return mapRows(rows) as unknown as CertificateAuthority[];
  }

  async create(input: NewCertificateAuthority) {
    const now = new Date().toISOString();
    const values = [
      input.name,
      input.subjectId,
      input.issuerCaId,
      input.certificatePem,
      input.privateKeyPem,
      input.serialNumber,
      input.issuedAt,
      input.expiresAt,
      input.validityDays,
      input.pathLength,
      boolValue(input.isSelfSigned, this.db),
      boolValue(input.isDefault, this.db),
      boolValue(input.active, this.db),
      now,
      now
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO certificate_authorities (
        name,
        subject_id,
        issuer_ca_id,
        certificate_pem,
        private_key_pem,
        serial_number,
        issued_at,
        expires_at,
        validity_days,
        path_length,
        is_self_signed,
        is_default,
        active,
        created_at,
        updated_at
      ) VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id));
  }

  async clearDefaultRoot() {
    await this.db.run(`UPDATE certificate_authorities SET is_default = ${placeholder(1, this.db)}`, [boolValue(false, this.db)]);
  }

  async setDefaultRoot(id: number) {
    await this.clearDefaultRoot();
    await this.db.run(
      `UPDATE certificate_authorities SET is_default = ${placeholder(1, this.db)} WHERE id = ${placeholder(2, this.db)}`,
      [boolValue(true, this.db), id]
    );
    return this.getById(id);
  }

  async getDefaultRoot() {
    const row = await this.db.get<CertificateAuthority & Record<string, unknown>>(
      `SELECT
        ca.id,
        ca.name,
        ca.subject_id AS "subjectId",
        ca.issuer_ca_id AS "issuerCaId",
        subject.name AS "subjectName",
        issuer.name AS "issuerName",
        subject.common_name AS "commonName",
        ca.certificate_pem AS "certificatePem",
        ca.private_key_pem AS "privateKeyPem",
        ca.serial_number AS "serialNumber",
        ca.issued_at AS "issuedAt",
        ca.expires_at AS "expiresAt",
        ca.validity_days AS "validityDays",
        ca.path_length AS "pathLength",
        ca.is_self_signed AS "isSelfSigned",
        ca.is_default AS "isDefault",
        ca.active,
        ca.created_at AS "createdAt",
        ca.updated_at AS "updatedAt"
      FROM certificate_authorities ca
      INNER JOIN certificate_subjects subject ON subject.id = ca.subject_id
      LEFT JOIN certificate_authorities issuer ON issuer.id = ca.issuer_ca_id
      WHERE ca.is_default = ${placeholder(1, this.db)}
      ORDER BY ca.created_at ASC
      LIMIT 1`,
      [boolValue(true, this.db)]
    );
    return mapRecord(row);
  }
}
