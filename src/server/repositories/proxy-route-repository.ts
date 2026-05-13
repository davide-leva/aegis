import type { DatabaseContext, ProxyRoute } from "../types.js";
import { boolValue, mapRecord, mapRows, placeholder, resolveInsertedId } from "./helpers.js";

export type NewProxyRoute = Omit<ProxyRoute, "id" | "createdAt" | "updatedAt" | "healthStatus"> & {
  healthStatus?: ProxyRoute["healthStatus"];
};

export class ProxyRouteRepository {
  constructor(private readonly db: DatabaseContext) {}

  async getById(id: number) {
    const row = await this.db.get<ProxyRoute & Record<string, unknown>>(
      `SELECT
        id,
        name,
        protocol,
        network_interface_id AS "networkInterfaceId",
        listen_address AS "listenAddress",
        listen_port AS "listenPort",
        source_host AS "sourceHost",
        source_path AS "sourcePath",
        target_host AS "targetHost",
        target_port AS "targetPort",
        target_protocol AS "targetProtocol",
        preserve_host AS "preserveHost",
        tls_cert_pem AS "tlsCertPem",
        tls_key_pem AS "tlsKeyPem",
        health_status AS "healthStatus",
        enabled,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM proxy_routes
      WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
    return mapRecord(row);
  }

  async list(): Promise<ProxyRoute[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        id,
        name,
        protocol,
        network_interface_id AS "networkInterfaceId",
        listen_address AS "listenAddress",
        listen_port AS "listenPort",
        source_host AS "sourceHost",
        source_path AS "sourcePath",
        target_host AS "targetHost",
        target_port AS "targetPort",
        target_protocol AS "targetProtocol",
        preserve_host AS "preserveHost",
        tls_cert_pem AS "tlsCertPem",
        tls_key_pem AS "tlsKeyPem",
        health_status AS "healthStatus",
        enabled,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM proxy_routes
      ORDER BY protocol ASC, listen_port ASC, name ASC`
    );
    return mapRows(rows) as unknown as ProxyRoute[];
  }

  async listEnabled(): Promise<ProxyRoute[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        id,
        name,
        protocol,
        network_interface_id AS "networkInterfaceId",
        listen_address AS "listenAddress",
        listen_port AS "listenPort",
        source_host AS "sourceHost",
        source_path AS "sourcePath",
        target_host AS "targetHost",
        target_port AS "targetPort",
        target_protocol AS "targetProtocol",
        preserve_host AS "preserveHost",
        tls_cert_pem AS "tlsCertPem",
        tls_key_pem AS "tlsKeyPem",
        health_status AS "healthStatus",
        enabled,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM proxy_routes
      WHERE enabled = ${placeholder(1, this.db)}
      ORDER BY protocol ASC, listen_port ASC, name ASC`,
      [boolValue(true, this.db)]
    );
    return mapRows(rows) as unknown as ProxyRoute[];
  }

  async create(input: NewProxyRoute) {
    const now = new Date().toISOString();
    const values = [
      input.name,
      input.protocol,
      input.networkInterfaceId,
      input.listenAddress,
      input.listenPort,
      input.sourceHost,
      input.sourcePath,
      input.targetHost,
      input.targetPort,
      input.targetProtocol,
      boolValue(input.preserveHost, this.db),
      input.tlsCertPem,
      input.tlsKeyPem,
      input.healthStatus ?? "unknown",
      boolValue(input.enabled, this.db),
      now,
      now
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO proxy_routes (
        name,
        protocol,
        network_interface_id,
        listen_address,
        listen_port,
        source_host,
        source_path,
        target_host,
        target_port,
        target_protocol,
        preserve_host,
        tls_cert_pem,
        tls_key_pem,
        health_status,
        enabled,
        created_at,
        updated_at
      ) VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id));
  }

  async update(id: number, input: NewProxyRoute) {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE proxy_routes
      SET
        name = ${placeholder(1, this.db)},
        protocol = ${placeholder(2, this.db)},
        network_interface_id = ${placeholder(3, this.db)},
        listen_address = ${placeholder(4, this.db)},
        listen_port = ${placeholder(5, this.db)},
        source_host = ${placeholder(6, this.db)},
        source_path = ${placeholder(7, this.db)},
        target_host = ${placeholder(8, this.db)},
        target_port = ${placeholder(9, this.db)},
        target_protocol = ${placeholder(10, this.db)},
        preserve_host = ${placeholder(11, this.db)},
        tls_cert_pem = ${placeholder(12, this.db)},
        tls_key_pem = ${placeholder(13, this.db)},
        health_status = ${placeholder(14, this.db)},
        enabled = ${placeholder(15, this.db)},
        updated_at = ${placeholder(16, this.db)}
      WHERE id = ${placeholder(17, this.db)}`,
      [
        input.name,
        input.protocol,
        input.networkInterfaceId,
        input.listenAddress,
        input.listenPort,
        input.sourceHost,
        input.sourcePath,
        input.targetHost,
        input.targetPort,
        input.targetProtocol,
        boolValue(input.preserveHost, this.db),
        input.tlsCertPem,
        input.tlsKeyPem,
        input.healthStatus ?? "unknown",
        boolValue(input.enabled, this.db),
        now,
        id
      ]
    );
    return this.getById(id);
  }

  async updateHealthStatus(id: number, status: "healthy" | "degraded" | "unknown") {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE proxy_routes SET health_status = ${placeholder(1, this.db)}, updated_at = ${placeholder(2, this.db)}
       WHERE id = ${placeholder(3, this.db)}`,
      [status, now, id]
    );
  }

  async updateTlsCert(oldCertPem: string, newCertPem: string, newKeyPem: string): Promise<number> {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE proxy_routes
       SET tls_cert_pem = ${placeholder(1, this.db)},
           tls_key_pem = ${placeholder(2, this.db)},
           updated_at = ${placeholder(3, this.db)}
       WHERE tls_cert_pem = ${placeholder(4, this.db)}`,
      [newCertPem, newKeyPem, now, oldCertPem]
    );
    return 0;
  }

  async delete(id: number) {
    const existing = await this.getById(id);
    if (!existing) {
      return null;
    }
    await this.db.run(`DELETE FROM proxy_routes WHERE id = ${placeholder(1, this.db)}`, [id]);
    return existing;
  }
}
