import type { DatabaseContext, DnsQueryLogEntry, DnsRuntimeMetrics } from "../types.js";
import { placeholder, resolveInsertedId } from "./helpers.js";

export class DnsQueryLogRepository {
  constructor(private readonly db: DatabaseContext) {}

  async create(input: Omit<DnsQueryLogEntry, "id" | "createdAt"> & { createdAt?: string }) {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const values = [
      input.protocol,
      input.clientIp,
      input.questionName,
      input.questionType,
      input.resolutionMode,
      input.responseCode,
      input.answerCount,
      input.durationMs,
      input.zoneName,
      input.upstreamName,
      createdAt
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO dns_query_logs (
        protocol,
        client_ip,
        question_name,
        question_type,
        resolution_mode,
        response_code,
        answer_count,
        duration_ms,
        zone_name,
        upstream_name,
        created_at
      ) VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.db.get<DnsQueryLogEntry & Record<string, unknown>>(
      `SELECT
        id,
        protocol,
        client_ip AS "clientIp",
        question_name AS "questionName",
        question_type AS "questionType",
        resolution_mode AS "resolutionMode",
        response_code AS "responseCode",
        answer_count AS "answerCount",
        duration_ms AS "durationMs",
        zone_name AS "zoneName",
        upstream_name AS "upstreamName",
        created_at AS "createdAt"
      FROM dns_query_logs
      WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
  }

  async listRecent(limit = 100): Promise<DnsQueryLogEntry[]> {
    return this.db.all<DnsQueryLogEntry & Record<string, unknown>>(
      `SELECT
        id,
        protocol,
        client_ip AS "clientIp",
        question_name AS "questionName",
        question_type AS "questionType",
        resolution_mode AS "resolutionMode",
        response_code AS "responseCode",
        answer_count AS "answerCount",
        duration_ms AS "durationMs",
        zone_name AS "zoneName",
        upstream_name AS "upstreamName",
        created_at AS "createdAt"
      FROM dns_query_logs
      ORDER BY created_at DESC
      LIMIT ${placeholder(1, this.db)}`,
      [limit]
    );
  }

  async getMetrics(): Promise<DnsRuntimeMetrics> {
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT
        COUNT(*) AS "totalQueries",
        SUM(CASE WHEN resolution_mode = 'authoritative' THEN 1 ELSE 0 END) AS "authoritativeQueries",
        SUM(CASE WHEN resolution_mode = 'upstream' THEN 1 ELSE 0 END) AS "upstreamQueries",
        SUM(CASE WHEN resolution_mode = 'blocked' THEN 1 ELSE 0 END) AS "blockedQueries",
        SUM(CASE WHEN resolution_mode = 'nxdomain' THEN 1 ELSE 0 END) AS "nxDomainQueries",
        SUM(CASE WHEN resolution_mode = 'servfail' THEN 1 ELSE 0 END) AS "servfailQueries",
        COALESCE(AVG(duration_ms), 0) AS "avgDurationMs",
        MAX(created_at) AS "lastQueryAt"
      FROM dns_query_logs`
    );

    return {
      totalQueries: Number(row?.totalQueries ?? 0),
      authoritativeQueries: Number(row?.authoritativeQueries ?? 0),
      upstreamQueries: Number(row?.upstreamQueries ?? 0),
      blockedQueries: Number(row?.blockedQueries ?? 0),
      nxDomainQueries: Number(row?.nxDomainQueries ?? 0),
      servfailQueries: Number(row?.servfailQueries ?? 0),
      avgDurationMs: Number(row?.avgDurationMs ?? 0),
      lastQueryAt: (row?.lastQueryAt as string | null | undefined) ?? null
    };
  }
}
