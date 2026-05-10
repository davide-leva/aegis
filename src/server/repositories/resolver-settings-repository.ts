import type { BootstrapSettings, DatabaseContext, ResolverSettings } from "../types.js";
import { boolValue, mapRecord, placeholder, resolveInsertedId } from "./helpers.js";

export class ResolverSettingsRepository {
  constructor(private readonly db: DatabaseContext) {}

  async get(): Promise<ResolverSettings | null> {
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT
        id,
        organization_name AS "organizationName",
        primary_contact_email AS "primaryContactEmail",
        default_zone_suffix AS "defaultZoneSuffix",
        upstream_mode AS "upstreamMode",
        dns_listen_port AS "dnsListenPort",
        blocklist_enabled AS "blocklistEnabled",
        setup_completed_at AS "setupCompletedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM resolver_settings
      ORDER BY id ASC
      LIMIT 1`
    );

    return (mapRecord(row) as ResolverSettings | undefined) ?? null;
  }

  async create(input: BootstrapSettings) {
    const now = new Date().toISOString();
    const values = [
      input.organizationName,
      input.primaryContactEmail,
      input.defaultZoneSuffix,
      input.upstreamMode,
      input.dnsListenPort,
      boolValue(input.blocklistEnabled, this.db),
      now,
      now,
      now
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO resolver_settings (
        organization_name,
        primary_contact_email,
        default_zone_suffix,
        upstream_mode,
        dns_listen_port,
        blocklist_enabled,
        setup_completed_at,
        created_at,
        updated_at
      ) VALUES (${markers})${returning}`,
      values
    );

    const id = await resolveInsertedId(this.db, result.lastInsertId);
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT
        id,
        organization_name AS "organizationName",
        primary_contact_email AS "primaryContactEmail",
        default_zone_suffix AS "defaultZoneSuffix",
        upstream_mode AS "upstreamMode",
        dns_listen_port AS "dnsListenPort",
        blocklist_enabled AS "blocklistEnabled",
        setup_completed_at AS "setupCompletedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM resolver_settings
      WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
    return mapRecord(row) as ResolverSettings | undefined;
  }
}
