import type { DatabaseContext, ProxyRequestLogEntry, ProxyRuntimeMetrics } from "../types.js";
import { placeholder, resolveInsertedId } from "./helpers.js";

export class ProxyRequestLogRepository {
  constructor(private readonly db: DatabaseContext) {}

  async create(input: Omit<ProxyRequestLogEntry, "id" | "createdAt"> & { createdAt?: string }) {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const values = [
      input.routeId,
      input.routeName,
      input.protocol,
      input.clientIp,
      input.targetHost,
      input.targetPort,
      input.outcome,
      input.statusCode,
      input.bytesIn,
      input.bytesOut,
      input.durationMs,
      input.metadata,
      createdAt
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO proxy_request_logs (
        route_id,
        route_name,
        protocol,
        client_ip,
        target_host,
        target_port,
        outcome,
        status_code,
        bytes_in,
        bytes_out,
        duration_ms,
        metadata,
        created_at
      ) VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.db.get<ProxyRequestLogEntry & Record<string, unknown>>(
      `SELECT
        id,
        route_id AS "routeId",
        route_name AS "routeName",
        protocol,
        client_ip AS "clientIp",
        target_host AS "targetHost",
        target_port AS "targetPort",
        outcome,
        status_code AS "statusCode",
        bytes_in AS "bytesIn",
        bytes_out AS "bytesOut",
        duration_ms AS "durationMs",
        metadata,
        created_at AS "createdAt"
      FROM proxy_request_logs
      WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
  }

  async listRecent(limit = 100): Promise<ProxyRequestLogEntry[]> {
    return this.db.all<ProxyRequestLogEntry & Record<string, unknown>>(
      `SELECT
        id,
        route_id AS "routeId",
        route_name AS "routeName",
        protocol,
        client_ip AS "clientIp",
        target_host AS "targetHost",
        target_port AS "targetPort",
        outcome,
        status_code AS "statusCode",
        bytes_in AS "bytesIn",
        bytes_out AS "bytesOut",
        duration_ms AS "durationMs",
        metadata,
        created_at AS "createdAt"
      FROM proxy_request_logs
      ORDER BY created_at DESC
      LIMIT ${placeholder(1, this.db)}`,
      [limit]
    );
  }

  async getMetrics(): Promise<ProxyRuntimeMetrics> {
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT
        COUNT(*) AS "totalRequests",
        SUM(CASE WHEN protocol = 'http' THEN 1 ELSE 0 END) AS "httpRequests",
        SUM(CASE WHEN protocol = 'https' THEN 1 ELSE 0 END) AS "httpsRequests",
        SUM(CASE WHEN protocol = 'tcp' THEN 1 ELSE 0 END) AS "tcpSessions",
        SUM(CASE WHEN protocol = 'udp' THEN 1 ELSE 0 END) AS "udpPackets",
        SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS "errors",
        COALESCE(AVG(duration_ms), 0) AS "avgDurationMs",
        MAX(created_at) AS "lastActivityAt"
      FROM proxy_request_logs`
    );

    return {
      totalRequests: Number(row?.totalRequests ?? 0),
      httpRequests: Number(row?.httpRequests ?? 0),
      httpsRequests: Number(row?.httpsRequests ?? 0),
      tcpSessions: Number(row?.tcpSessions ?? 0),
      udpPackets: Number(row?.udpPackets ?? 0),
      errors: Number(row?.errors ?? 0),
      avgDurationMs: Number(row?.avgDurationMs ?? 0),
      lastActivityAt: (row?.lastActivityAt as string | null | undefined) ?? null
    };
  }
}
