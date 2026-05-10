import type { CertificateSubject, DatabaseContext } from "../types.js";
import { mapRecord, mapRows, placeholder, resolveInsertedId } from "./helpers.js";

export type NewCertificateSubject = Omit<CertificateSubject, "id" | "createdAt" | "updatedAt">;

export class CertificateSubjectRepository {
  constructor(private readonly db: DatabaseContext) {}

  async getById(id: number) {
    const row = await this.db.get<CertificateSubject & Record<string, unknown>>(
      `SELECT
        subject.id,
        subject.name,
        subject.parent_subject_id AS "parentSubjectId",
        parent.name AS "parentSubjectName",
        subject.common_name AS "commonName",
        subject.organization,
        subject.organizational_unit AS "organizationalUnit",
        subject.country,
        subject.state,
        subject.locality,
        subject.email_address AS "emailAddress",
        subject.created_at AS "createdAt",
        subject.updated_at AS "updatedAt"
      FROM certificate_subjects subject
      LEFT JOIN certificate_subjects parent ON parent.id = subject.parent_subject_id
      WHERE subject.id = ${placeholder(1, this.db)}`,
      [id]
    );
    return mapRecord(row);
  }

  async list(): Promise<CertificateSubject[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        subject.id,
        subject.name,
        subject.parent_subject_id AS "parentSubjectId",
        parent.name AS "parentSubjectName",
        subject.common_name AS "commonName",
        subject.organization,
        subject.organizational_unit AS "organizationalUnit",
        subject.country,
        subject.state,
        subject.locality,
        subject.email_address AS "emailAddress",
        subject.created_at AS "createdAt",
        subject.updated_at AS "updatedAt"
      FROM certificate_subjects subject
      LEFT JOIN certificate_subjects parent ON parent.id = subject.parent_subject_id
      ORDER BY subject.name ASC`
    );
    return mapRows(rows) as unknown as CertificateSubject[];
  }

  async create(input: NewCertificateSubject) {
    const now = new Date().toISOString();
    const values = [
      input.name,
      input.parentSubjectId,
      input.commonName,
      input.organization,
      input.organizationalUnit,
      input.country,
      input.state,
      input.locality,
      input.emailAddress,
      now,
      now
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO certificate_subjects (
        name,
        parent_subject_id,
        common_name,
        organization,
        organizational_unit,
        country,
        state,
        locality,
        email_address,
        created_at,
        updated_at
      ) VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id));
  }

  async update(id: number, input: NewCertificateSubject) {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE certificate_subjects
      SET
        name = ${placeholder(1, this.db)},
        parent_subject_id = ${placeholder(2, this.db)},
        common_name = ${placeholder(3, this.db)},
        organization = ${placeholder(4, this.db)},
        organizational_unit = ${placeholder(5, this.db)},
        country = ${placeholder(6, this.db)},
        state = ${placeholder(7, this.db)},
        locality = ${placeholder(8, this.db)},
        email_address = ${placeholder(9, this.db)},
        updated_at = ${placeholder(10, this.db)}
      WHERE id = ${placeholder(11, this.db)}`,
      [
        input.name,
        input.parentSubjectId,
        input.commonName,
        input.organization,
        input.organizationalUnit,
        input.country,
        input.state,
        input.locality,
        input.emailAddress,
        now,
        id
      ]
    );
    return this.getById(id);
  }

  async delete(id: number) {
    const existing = await this.getById(id);
    if (!existing) {
      return null;
    }
    await this.db.run(`DELETE FROM certificate_subjects WHERE id = ${placeholder(1, this.db)}`, [id]);
    return existing;
  }
}
