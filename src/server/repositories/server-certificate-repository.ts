import type { DatabaseContext, ServerCertificate } from "../types.js";
import { boolValue, mapRecord, mapRows, placeholder, resolveInsertedId } from "./helpers.js";

export type NewServerCertificate = Omit<
  ServerCertificate,
  "id" | "createdAt" | "updatedAt" | "subjectName" | "caName" | "commonName"
>;

function parseSubjectAltNames(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapServerCertificate(row: (ServerCertificate & Record<string, unknown>) | undefined) {
  const mapped = mapRecord(row);
  if (!mapped) {
    return mapped;
  }
  return {
    ...mapped,
    subjectAltNames: parseSubjectAltNames(mapped.subjectAltNames)
  } as ServerCertificate;
}

export class ServerCertificateRepository {
  constructor(private readonly db: DatabaseContext) {}

  async getById(id: number) {
    const row = await this.db.get<ServerCertificate & Record<string, unknown>>(
      `SELECT
        cert.id,
        cert.name,
        cert.subject_id AS "subjectId",
        cert.ca_id AS "caId",
        subject.name AS "subjectName",
        ca.name AS "caName",
        subject.common_name AS "commonName",
        cert.subject_alt_names AS "subjectAltNames",
        cert.certificate_pem AS "certificatePem",
        cert.private_key_pem AS "privateKeyPem",
        cert.chain_pem AS "chainPem",
        cert.serial_number AS "serialNumber",
        cert.issued_at AS "issuedAt",
        cert.expires_at AS "expiresAt",
        cert.validity_days AS "validityDays",
        cert.renewal_days AS "renewalDays",
        cert.active,
        cert.created_at AS "createdAt",
        cert.updated_at AS "updatedAt"
      FROM server_certificates cert
      INNER JOIN certificate_subjects subject ON subject.id = cert.subject_id
      INNER JOIN certificate_authorities ca ON ca.id = cert.ca_id
      WHERE cert.id = ${placeholder(1, this.db)}`,
      [id]
    );
    return mapServerCertificate(row);
  }

  async list(): Promise<ServerCertificate[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        cert.id,
        cert.name,
        cert.subject_id AS "subjectId",
        cert.ca_id AS "caId",
        subject.name AS "subjectName",
        ca.name AS "caName",
        subject.common_name AS "commonName",
        cert.subject_alt_names AS "subjectAltNames",
        cert.certificate_pem AS "certificatePem",
        cert.private_key_pem AS "privateKeyPem",
        cert.chain_pem AS "chainPem",
        cert.serial_number AS "serialNumber",
        cert.issued_at AS "issuedAt",
        cert.expires_at AS "expiresAt",
        cert.validity_days AS "validityDays",
        cert.renewal_days AS "renewalDays",
        cert.active,
        cert.created_at AS "createdAt",
        cert.updated_at AS "updatedAt"
      FROM server_certificates cert
      INNER JOIN certificate_subjects subject ON subject.id = cert.subject_id
      INNER JOIN certificate_authorities ca ON ca.id = cert.ca_id
      ORDER BY cert.created_at DESC, cert.name ASC`
    );
    return mapRows(rows).map((row) => mapServerCertificate(row as ServerCertificate & Record<string, unknown>)!) as ServerCertificate[];
  }

  async create(input: NewServerCertificate) {
    const now = new Date().toISOString();
    const values = [
      input.name,
      input.subjectId,
      input.caId,
      this.db.driver === "postgres" ? JSON.stringify(input.subjectAltNames) : JSON.stringify(input.subjectAltNames),
      input.certificatePem,
      input.privateKeyPem,
      input.chainPem,
      input.serialNumber,
      input.issuedAt,
      input.expiresAt,
      input.validityDays,
      input.renewalDays,
      boolValue(input.active, this.db),
      now,
      now
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO server_certificates (
        name,
        subject_id,
        ca_id,
        subject_alt_names,
        certificate_pem,
        private_key_pem,
        chain_pem,
        serial_number,
        issued_at,
        expires_at,
        validity_days,
        renewal_days,
        active,
        created_at,
        updated_at
      ) VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id));
  }

  async updateMaterial(id: number, input: NewServerCertificate) {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE server_certificates
      SET
        name = ${placeholder(1, this.db)},
        subject_id = ${placeholder(2, this.db)},
        ca_id = ${placeholder(3, this.db)},
        subject_alt_names = ${placeholder(4, this.db)},
        certificate_pem = ${placeholder(5, this.db)},
        private_key_pem = ${placeholder(6, this.db)},
        chain_pem = ${placeholder(7, this.db)},
        serial_number = ${placeholder(8, this.db)},
        issued_at = ${placeholder(9, this.db)},
        expires_at = ${placeholder(10, this.db)},
        validity_days = ${placeholder(11, this.db)},
        renewal_days = ${placeholder(12, this.db)},
        active = ${placeholder(13, this.db)},
        updated_at = ${placeholder(14, this.db)}
      WHERE id = ${placeholder(15, this.db)}`,
      [
        input.name,
        input.subjectId,
        input.caId,
        JSON.stringify(input.subjectAltNames),
        input.certificatePem,
        input.privateKeyPem,
        input.chainPem,
        input.serialNumber,
        input.issuedAt,
        input.expiresAt,
        input.validityDays,
        input.renewalDays,
        boolValue(input.active, this.db),
        now,
        id
      ]
    );
    return this.getById(id);
  }
}
