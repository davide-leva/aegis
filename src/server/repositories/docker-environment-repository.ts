import type { DatabaseContext, DockerEnvironment } from "../types.js";
import { boolValue, mapRecord, mapRows, placeholder, resolveInsertedId } from "./helpers.js";

export type NewDockerEnvironment = Omit<DockerEnvironment, "id" | "createdAt" | "updatedAt">;

export class DockerEnvironmentRepository {
  constructor(private readonly db: DatabaseContext) {}

  async getById(id: number) {
    const row = await this.db.get<DockerEnvironment & Record<string, unknown>>(
      `SELECT
        id,
        name,
        connection_type AS "connectionType",
        socket_path AS "socketPath",
        host,
        port,
        tls_ca_pem AS "tlsCaPem",
        tls_cert_pem AS "tlsCertPem",
        tls_key_pem AS "tlsKeyPem",
        public_ip AS "publicIp",
        enabled,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM docker_environments
      WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
    return mapRecord(row);
  }

  async list(): Promise<DockerEnvironment[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        id,
        name,
        connection_type AS "connectionType",
        socket_path AS "socketPath",
        host,
        port,
        tls_ca_pem AS "tlsCaPem",
        tls_cert_pem AS "tlsCertPem",
        tls_key_pem AS "tlsKeyPem",
        public_ip AS "publicIp",
        enabled,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM docker_environments
      ORDER BY name ASC`
    );
    return mapRows(rows) as unknown as DockerEnvironment[];
  }

  async create(input: NewDockerEnvironment) {
    const now = new Date().toISOString();
    const values = [
      input.name,
      input.connectionType,
      input.socketPath,
      input.host,
      input.port,
      input.tlsCaPem,
      input.tlsCertPem,
      input.tlsKeyPem,
      input.publicIp,
      boolValue(input.enabled, this.db),
      now,
      now
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO docker_environments (
        name,
        connection_type,
        socket_path,
        host,
        port,
        tls_ca_pem,
        tls_cert_pem,
        tls_key_pem,
        public_ip,
        enabled,
        created_at,
        updated_at
      ) VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id));
  }

  async update(id: number, input: NewDockerEnvironment) {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE docker_environments
      SET
        name = ${placeholder(1, this.db)},
        connection_type = ${placeholder(2, this.db)},
        socket_path = ${placeholder(3, this.db)},
        host = ${placeholder(4, this.db)},
        port = ${placeholder(5, this.db)},
        tls_ca_pem = ${placeholder(6, this.db)},
        tls_cert_pem = ${placeholder(7, this.db)},
        tls_key_pem = ${placeholder(8, this.db)},
        public_ip = ${placeholder(9, this.db)},
        enabled = ${placeholder(10, this.db)},
        updated_at = ${placeholder(11, this.db)}
      WHERE id = ${placeholder(12, this.db)}`,
      [
        input.name,
        input.connectionType,
        input.socketPath,
        input.host,
        input.port,
        input.tlsCaPem,
        input.tlsCertPem,
        input.tlsKeyPem,
        input.publicIp,
        boolValue(input.enabled, this.db),
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
    await this.db.run(`DELETE FROM docker_environments WHERE id = ${placeholder(1, this.db)}`, [id]);
    return existing;
  }
}
