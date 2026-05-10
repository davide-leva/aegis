import { EventBus } from "../events/event-bus.js";
import type { AuditAction, AuditContext, BootstrapSettings, DnsRuntimeStatus } from "../types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type { NewBlocklistEntry } from "../repositories/blocklist-repository.js";
import type { NewRecord } from "../repositories/dns-record-repository.js";
import type { NewUpstream } from "../repositories/dns-upstream-repository.js";
import type { NewZone } from "../repositories/dns-zone-repository.js";

interface RuntimeControl {
  requestReload(): void;
  getStatus(): DnsRuntimeStatus;
}

export class DnsService {
  constructor(
    private readonly repositories: Repositories,
    private readonly eventBus: EventBus,
    private readonly runtimeControl?: RuntimeControl
  ) {}

  async getBootstrap(context: AuditContext) {
    const settings = await this.repositories.resolverSettings.get();
    await this.audit("bootstrap.read", "resolver_settings", settings?.id, context, {
      bootstrapCompleted: Boolean(settings)
    });
    return {
      bootstrapCompleted: Boolean(settings),
      settings
    };
  }

  async completeBootstrap(input: BootstrapSettings, context: AuditContext) {
    const result = await this.repositories.db.transaction(async (trx) => {
      const scopedRepos = createRepositories(trx);
      const scopedEvents = new EventBus(scopedRepos);
      const existing = await scopedRepos.resolverSettings.get();
      if (existing) {
        throw new Error("Bootstrap already completed");
      }

      const settings = await scopedRepos.resolverSettings.create(input);
      const zone = await scopedRepos.zones.create({
        name: input.defaultZoneSuffix.replace(/^\./, ""),
        kind: "local",
        description: "Bootstrap local primary zone",
        isPrimary: true,
        isReverse: false,
        ttl: 3600,
        enabled: true
      });

      await scopedRepos.audit.create({
        action: "bootstrap.create",
        entityType: "resolver_settings",
        entityId: settings?.id ? String(settings.id) : null,
        payload: {
          settings,
          bootstrapZoneId: zone?.id ?? null
        },
        context
      });

      if (settings?.id) {
        await scopedEvents.publish({
          topic: "dns.bootstrap.completed",
          aggregateType: "resolver_settings",
          aggregateId: String(settings.id),
          payload: {
            organizationName: settings.organizationName,
            defaultZoneSuffix: settings.defaultZoneSuffix,
            zoneId: zone?.id ?? null
          },
          context
        });
      }

      return {
        bootstrapCompleted: true,
        settings
      };
    });
    this.runtimeControl?.requestReload();
    return result;
  }

  async getDashboard(context: AuditContext) {
    const [settings, zones, records, upstreams, blocklist] = await Promise.all([
      this.repositories.resolverSettings.get(),
      this.repositories.zones.list(),
      this.repositories.records.list(),
      this.repositories.upstreams.list(),
      this.repositories.blocklist.list()
    ]);

    const dashboard = {
      bootstrapCompleted: Boolean(settings),
      settings,
      summary: {
        zones: zones.length,
        records: records.length,
        upstreams: upstreams.length,
        blocklistEntries: blocklist.length,
        primaryZones: zones.filter((zone) => zone.isPrimary).length,
        disabledRecords: records.filter((record) => !record.enabled).length
      },
      zones,
      records,
      upstreams,
      blocklist
    };

    await this.audit("dashboard.read", "dns_dashboard", null, context, {
      summary: dashboard.summary
    });

    return dashboard;
  }

  async listZones(context: AuditContext) {
    const zones = await this.repositories.zones.list();
    await this.audit("zone.list", "dns_zone", null, context, { count: zones.length });
    return zones;
  }

  async createZone(input: NewZone, context: AuditContext) {
    const zone = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const zone = await repos.zones.create(input);
      await repos.audit.create({
        action: "zone.create",
        entityType: "dns_zone",
        entityId: zone?.id ? String(zone.id) : null,
        payload: zone ?? null,
        context
      });
      if (zone?.id) {
        await events.publish({
          topic: "dns.zone.created",
          aggregateType: "dns_zone",
          aggregateId: String(zone.id),
          payload: zone,
          context
        });
      }
      return zone;
    });
    this.runtimeControl?.requestReload();
    return zone;
  }

  async updateZone(id: number, input: NewZone, context: AuditContext) {
    const zone = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.zones.getById(id);
      if (!existing) {
        throw new Error("Zone not found");
      }
      const zone = await repos.zones.update(id, input);
      await repos.audit.create({
        action: "zone.update",
        entityType: "dns_zone",
        entityId: String(id),
        payload: { before: existing, after: zone },
        context
      });
      if (zone) {
        await events.publish({
          topic: "dns.zone.updated",
          aggregateType: "dns_zone",
          aggregateId: String(id),
          payload: zone,
          context
        });
      }
      return zone;
    });
    this.runtimeControl?.requestReload();
    return zone;
  }

  async deleteZone(id: number, context: AuditContext) {
    const zone = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.zones.delete(id);
      if (!existing) {
        throw new Error("Zone not found");
      }
      await repos.audit.create({
        action: "zone.delete",
        entityType: "dns_zone",
        entityId: String(id),
        payload: existing,
        context
      });
      await events.publish({
        topic: "dns.zone.deleted",
        aggregateType: "dns_zone",
        aggregateId: String(id),
        payload: existing,
        context
      });
      return existing;
    });
    this.runtimeControl?.requestReload();
    return zone;
  }

  async listRecords(context: AuditContext) {
    const records = await this.repositories.records.list();
    await this.audit("record.list", "dns_record", null, context, { count: records.length });
    return records;
  }

  async createRecord(input: NewRecord, context: AuditContext) {
    const record = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const record = await repos.records.create(input);
      await repos.audit.create({
        action: "record.create",
        entityType: "dns_record",
        entityId: record?.id ? String(record.id) : null,
        payload: record ?? null,
        context
      });
      if (record?.id) {
        await events.publish({
          topic: "dns.record.created",
          aggregateType: "dns_record",
          aggregateId: String(record.id),
          payload: record,
          context
        });
      }
      return record;
    });
    this.runtimeControl?.requestReload();
    return record;
  }

  async updateRecord(id: number, input: NewRecord, context: AuditContext) {
    const record = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.records.getById(id);
      if (!existing) {
        throw new Error("Record not found");
      }
      const record = await repos.records.update(id, input);
      await repos.audit.create({
        action: "record.update",
        entityType: "dns_record",
        entityId: String(id),
        payload: { before: existing, after: record },
        context
      });
      if (record) {
        await events.publish({
          topic: "dns.record.updated",
          aggregateType: "dns_record",
          aggregateId: String(id),
          payload: record,
          context
        });
      }
      return record;
    });
    this.runtimeControl?.requestReload();
    return record;
  }

  async deleteRecord(id: number, context: AuditContext) {
    const record = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.records.delete(id);
      if (!existing) {
        throw new Error("Record not found");
      }
      await repos.audit.create({
        action: "record.delete",
        entityType: "dns_record",
        entityId: String(id),
        payload: existing,
        context
      });
      await events.publish({
        topic: "dns.record.deleted",
        aggregateType: "dns_record",
        aggregateId: String(id),
        payload: existing,
        context
      });
      return existing;
    });
    this.runtimeControl?.requestReload();
    return record;
  }

  async listUpstreams(context: AuditContext) {
    const upstreams = await this.repositories.upstreams.list();
    await this.audit("upstream.list", "dns_upstream", null, context, { count: upstreams.length });
    return upstreams;
  }

  async createUpstream(input: NewUpstream, context: AuditContext) {
    const upstream = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const upstream = await repos.upstreams.create(input);
      await repos.audit.create({
        action: "upstream.create",
        entityType: "dns_upstream",
        entityId: upstream?.id ? String(upstream.id) : null,
        payload: upstream ?? null,
        context
      });
      if (upstream?.id) {
        await events.publish({
          topic: "dns.upstream.created",
          aggregateType: "dns_upstream",
          aggregateId: String(upstream.id),
          payload: upstream,
          context
        });
      }
      return upstream;
    });
    this.runtimeControl?.requestReload();
    return upstream;
  }

  async updateUpstream(id: number, input: NewUpstream, context: AuditContext) {
    const upstream = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.upstreams.getById(id);
      if (!existing) {
        throw new Error("Upstream not found");
      }
      const upstream = await repos.upstreams.update(id, input);
      await repos.audit.create({
        action: "upstream.update",
        entityType: "dns_upstream",
        entityId: String(id),
        payload: { before: existing, after: upstream },
        context
      });
      if (upstream) {
        await events.publish({
          topic: "dns.upstream.updated",
          aggregateType: "dns_upstream",
          aggregateId: String(id),
          payload: upstream,
          context
        });
      }
      return upstream;
    });
    this.runtimeControl?.requestReload();
    return upstream;
  }

  async deleteUpstream(id: number, context: AuditContext) {
    const upstream = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.upstreams.delete(id);
      if (!existing) {
        throw new Error("Upstream not found");
      }
      await repos.audit.create({
        action: "upstream.delete",
        entityType: "dns_upstream",
        entityId: String(id),
        payload: existing,
        context
      });
      await events.publish({
        topic: "dns.upstream.deleted",
        aggregateType: "dns_upstream",
        aggregateId: String(id),
        payload: existing,
        context
      });
      return existing;
    });
    this.runtimeControl?.requestReload();
    return upstream;
  }

  async listBlocklist(context: AuditContext) {
    const entries = await this.repositories.blocklist.list();
    await this.audit("blocklist.list", "blocklist_entry", null, context, { count: entries.length });
    return entries;
  }

  async createBlocklistEntry(input: NewBlocklistEntry, context: AuditContext) {
    const entry = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const entry = await repos.blocklist.create(input);
      await repos.audit.create({
        action: "blocklist.create",
        entityType: "blocklist_entry",
        entityId: entry?.id ? String(entry.id) : null,
        payload: entry ?? null,
        context
      });
      if (entry?.id) {
        await events.publish({
          topic: "dns.blocklist.created",
          aggregateType: "blocklist_entry",
          aggregateId: String(entry.id),
          payload: entry,
          context
        });
      }
      return entry;
    });
    this.runtimeControl?.requestReload();
    return entry;
  }

  async updateBlocklistEntry(id: number, input: NewBlocklistEntry, context: AuditContext) {
    const entry = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.blocklist.getById(id);
      if (!existing) {
        throw new Error("Blocklist entry not found");
      }
      const entry = await repos.blocklist.update(id, input);
      await repos.audit.create({
        action: "blocklist.update",
        entityType: "blocklist_entry",
        entityId: String(id),
        payload: { before: existing, after: entry },
        context
      });
      if (entry) {
        await events.publish({
          topic: "dns.blocklist.updated",
          aggregateType: "blocklist_entry",
          aggregateId: String(id),
          payload: entry,
          context
        });
      }
      return entry;
    });
    this.runtimeControl?.requestReload();
    return entry;
  }

  async deleteBlocklistEntry(id: number, context: AuditContext) {
    const entry = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.blocklist.delete(id);
      if (!existing) {
        throw new Error("Blocklist entry not found");
      }
      await repos.audit.create({
        action: "blocklist.delete",
        entityType: "blocklist_entry",
        entityId: String(id),
        payload: existing,
        context
      });
      await events.publish({
        topic: "dns.blocklist.deleted",
        aggregateType: "blocklist_entry",
        aggregateId: String(id),
        payload: existing,
        context
      });
      return existing;
    });
    this.runtimeControl?.requestReload();
    return entry;
  }

  async listAuditLogs(context: AuditContext, limit = 100) {
    const logs = await this.repositories.audit.list(limit);
    await this.audit("audit.list", "audit_log", null, context, { count: logs.length, limit });
    return logs;
  }

  async listEvents(context: AuditContext, limit = 100) {
    const events = await this.repositories.events.list(limit);
    await this.audit("event.list", "domain_event", null, context, { count: events.length, limit });
    return events;
  }

  async getRuntimeStatus(context: AuditContext) {
    const runtimeStatus = this.runtimeControl?.getStatus() ?? {
      state: "stopped",
      pid: null,
      restarts: 0,
      lastStartedAt: null,
      lastHeartbeatAt: null,
      lastError: "Runtime manager unavailable",
      listening: {
        udpPort: null,
        tcpPort: null,
        address: null
      }
    };
    await this.audit("runtime.status.read", "dns_runtime", null, context, {
      state: runtimeStatus.state
    });
    return runtimeStatus;
  }

  async getRuntimeMetrics(context: AuditContext) {
    const metrics = await this.repositories.queryLogs.getMetrics();
    await this.audit("runtime.metrics.read", "dns_runtime", null, context, metrics as unknown as Record<string, unknown>);
    return metrics;
  }

  async listRuntimeLogs(context: AuditContext, limit = 100) {
    const logs = await this.repositories.queryLogs.listRecent(limit);
    await this.audit("runtime.logs.read", "dns_query_log", null, context, { count: logs.length, limit });
    return logs;
  }

  private async audit(
    action: AuditAction,
    entityType: string,
    entityId: number | string | null | undefined,
    context: AuditContext,
    payload?: Record<string, unknown>
  ) {
    await this.repositories.audit.create({
      action,
      entityType,
      entityId: entityId == null ? null : String(entityId),
      payload: payload ?? null,
      context
    });
  }
}
