import { EventBus } from "../events/event-bus.js";
import { getCanonicalProxyListener } from "../lib/proxy-listeners.js";
import { generateServerCertificate } from "../lib/pki.js";
import { getEnvironmentResourceStats, inspectDockerContainer, listDockerContainers, watchDockerContainerEvents } from "../lib/docker-api.js";
import type { DockerContainerEvent } from "../lib/docker-api.js";
import { issueAcmeOrderMaterial } from "./acme-service.js";
import type { AcmeCertificate, AuditContext, DockerEnvironment as DockerEnvironmentEntity, ServerCertificate } from "../types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type { NewDockerEnvironment } from "../repositories/docker-environment-repository.js";
import type { NewDockerPortMapping } from "../repositories/docker-port-mapping-repository.js";
import type { NewProxyRoute } from "../repositories/proxy-route-repository.js";
import type { NewRecord } from "../repositories/dns-record-repository.js";
import type { NewServerCertificate } from "../repositories/server-certificate-repository.js";
import type { NewCertificateSubject } from "../repositories/certificate-subject-repository.js";

interface ProxyRuntimeControl {
  requestReload(): void;
}

interface DnsRuntimeControl {
  requestReload(): void;
}

export type CreateDockerPortMappingInput = {
  environmentId: number;
  containerId: string;
  privatePort: number;
  publicPort: number | null;
  protocol: "tcp" | "udp";
  dnsName: string;
  routeName: string;
  routeProtocol: "http" | "https" | "tcp" | "udp";
  networkInterfaceId: number | null;
  listenAddress: string;
  listenPort: number;
  sourcePath: string | null;
  preserveHost: boolean;
  enabled: boolean;
};

type AutomapCandidate = {
  service: string;
  dnsName: string;
  routeProtocol: "http" | "https" | "tcp" | "udp";
  privatePort: number;
  protocol: "tcp" | "udp";
  publicPort: number | null;
  routeName: string;
  networkInterfaceId: number | null;
  listenAddress: string;
  listenPort: number;
  sourcePath: string | null;
  preserveHost: boolean;
  enabled: boolean;
  alreadyMapped: boolean;
  existingRouteName: string | null;
};

type AutomapIssue = {
  service: string;
  severity: "error";
  code: "missing_port" | "invalid_port" | "port_not_exposed" | "protocol_mismatch" | "mapping_failed";
  message: string;
  labels: string[];
  signature: string;
};

export class DockerService {
  constructor(
    private readonly repositories: Repositories,
    _eventBus: EventBus,
    private readonly proxyRuntimeControl?: ProxyRuntimeControl,
    private readonly dnsRuntimeControl?: DnsRuntimeControl
  ) {}

  async getDashboard(context: AuditContext) {
    const environments = await this.repositories.dockerEnvironments.list();
    for (const environment of environments.filter((item) => item.enabled)) {
      await this.reconcileEnvironmentAutomaps(environment, context);
    }
    const mappings = await this.repositories.dockerPortMappings.listAll();

    const environmentStats = await Promise.all(
      environments.map(async (environment) => {
        if (!environment.enabled) {
          return {
            environmentId: environment.id,
            running: 0,
            restarting: 0,
            stopped: 0,
            error: null as string | null
          };
        }

        try {
          const containers = await listDockerContainers(environment);
          return {
            environmentId: environment.id,
            running: containers.filter((item) => item.state === "running").length,
            restarting: containers.filter((item) => item.state === "restarting").length,
            stopped: containers.filter((item) => item.state !== "running" && item.state !== "restarting").length,
            error: null as string | null
          };
        } catch (error) {
          return {
            environmentId: environment.id,
            running: 0,
            restarting: 0,
            stopped: 0,
            error: error instanceof Error ? error.message : "Environment unavailable"
          };
        }
      })
    );

    const dashboard = {
      summary: {
        environments: environments.length,
        enabledEnvironments: environments.filter((item) => item.enabled).length,
        mappings: mappings.length
      },
      environments,
      environmentStats,
      mappings
    };

    await this.audit("docker.dashboard.read", "docker_dashboard", null, context, dashboard.summary);
    return dashboard;
  }

  async listEnvironments(context: AuditContext) {
    const environments = await this.repositories.dockerEnvironments.list();
    await this.audit("docker.environment.list", "docker_environment", null, context, { count: environments.length });
    return environments;
  }

  async createEnvironment(input: NewDockerEnvironment, context: AuditContext) {
    const environment = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const created = await repos.dockerEnvironments.create(normalizeEnvironment(input));
      await repos.audit.create({
        action: "docker.environment.create",
        entityType: "docker_environment",
        entityId: created?.id ? String(created.id) : null,
        payload: redactEnvironment(created),
        context
      });
      if (created?.id) {
        await events.publish({
          topic: "docker.environment.created",
          aggregateType: "docker_environment",
          aggregateId: String(created.id),
          payload: redactEnvironment(created),
          context
        });
      }
      return created;
    });
    return environment;
  }

  async updateEnvironment(id: number, input: NewDockerEnvironment, context: AuditContext) {
    const environment = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.dockerEnvironments.getById(id);
      if (!existing) {
        throw new Error("Docker environment not found");
      }
      const updated = await repos.dockerEnvironments.update(id, normalizeEnvironment(input));
      await repos.audit.create({
        action: "docker.environment.update",
        entityType: "docker_environment",
        entityId: String(id),
        payload: {
          before: redactEnvironment(existing),
          after: redactEnvironment(updated)
        },
        context
      });
      if (updated) {
        await events.publish({
          topic: "docker.environment.updated",
          aggregateType: "docker_environment",
          aggregateId: String(id),
          payload: redactEnvironment(updated),
          context
        });
      }
      return updated;
    });
    return environment;
  }

  async deleteEnvironment(id: number, context: AuditContext) {
    const environment = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.dockerEnvironments.getById(id);
      if (!existing) {
        throw new Error("Docker environment not found");
      }
      const mappings = await repos.dockerPortMappings.listByEnvironment(id);
      for (const mapping of mappings) {
        await releaseMappingResources(repos, events, mapping, "environment_deleted", context);
      }

      await repos.dockerEnvironments.delete(id);
      await repos.audit.create({
        action: "docker.environment.delete",
        entityType: "docker_environment",
        entityId: String(id),
        payload: redactEnvironment(existing),
        context
      });
      await events.publish({
        topic: "docker.environment.deleted",
        aggregateType: "docker_environment",
        aggregateId: String(id),
        payload: redactEnvironment(existing),
        context
      });
      return existing;
    });

    this.proxyRuntimeControl?.requestReload();
    this.dnsRuntimeControl?.requestReload();
    return environment;
  }

  async listContainers(environmentId: number, context: AuditContext) {
    const environment = await this.requireEnvironment(environmentId);
    const containers = await listDockerContainers(environment);
    await this.reconcileEnvironmentAutomaps(environment, context, containers);
    const mappings = await this.repositories.dockerPortMappings.listByEnvironment(environmentId);

    const items = containers.map((container) => ({
      ...container,
      mappings: mappings.filter((mapping) => mapping.containerId === container.id)
    }));

    await this.audit("docker.container.list", "docker_container", String(environmentId), context, {
      count: items.length
    });
    return items;
  }

  async getContainerDetail(environmentId: number, containerId: string, context: AuditContext) {
    const environment = await this.requireEnvironment(environmentId);
    const detail = await inspectDockerContainer(environment, containerId);
    await this.reconcileContainerAutomap(environment, detail, context);
    const mappings = await this.repositories.dockerPortMappings.listByEnvironment(environmentId);
    const defaultInterface = await this.repositories.networkInterfaces.getDefault();

    const containerMappings = mappings.filter((mapping) => mapping.containerId === detail.id);
    const existingRouteNames = (await this.repositories.proxyRoutes.list()).map((route) => route.name);
    const automapAnalysis = analyzeAutomap(detail, containerMappings, defaultInterface, existingRouteNames);
    const enriched = {
      ...detail,
      mappings: containerMappings,
      automapCandidates: automapAnalysis.candidates,
      automapIssues: automapAnalysis.issues,
      automapEvents: await this.listContainerAutomapEvents(detail.id, 12),
      environment: {
        id: environment.id,
        name: environment.name,
        publicIp: environment.publicIp
      }
    };

    await this.audit("docker.container.read", "docker_container", containerId, context, {
      environmentId,
      exposedPorts: enriched.exposedPorts.length
    });
    return enriched;
  }

  async getEnvironmentResourceStats(environmentId: number) {
    const environment = await this.requireEnvironment(environmentId);
    const containers = await listDockerContainers(environment);
    const runningIds = containers.filter((c) => c.state === "running").map((c) => c.id);
    return getEnvironmentResourceStats(environment, runningIds);
  }

  async autoMapContainer(environmentId: number, containerId: string, context: AuditContext) {
    const environment = await this.requireEnvironment(environmentId);
    const detail = await inspectDockerContainer(environment, containerId);
    return this.reconcileContainerAutomap(environment, detail, context, true);
  }

  async createPortMapping(input: CreateDockerPortMappingInput, context: AuditContext) {
    const mapping = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const environment = await repos.dockerEnvironments.getById(input.environmentId);
      if (!environment) {
        throw new Error("Docker environment not found");
      }

      const settings = await repos.resolverSettings.get();
      if (!settings) {
        throw new Error("DNS bootstrap is required before creating Docker mappings");
      }
      const networkInterface = await resolveMappingInterface(repos, input.networkInterfaceId);

      const container = await inspectDockerContainer(environment, input.containerId);
      const target = resolveTarget(container, environment.publicIp, input.privatePort, input.publicPort, input.protocol);
      const protocol = input.routeProtocol;
      const dnsName = normalizeDnsName(input.dnsName);

      const dnsRecordResult = await ensureDnsRecord(repos, {
        dnsName,
        value: environment.publicIp,
        proxiedService: input.routeName.trim()
      });
      const dnsRecord = dnsRecordResult.record;
      if (dnsRecordResult.created && dnsRecord?.id) {
        await repos.audit.create({
          action: "record.create",
          entityType: "dns_record",
          entityId: String(dnsRecord.id),
          payload: dnsRecord as unknown as Record<string, unknown>,
          context
        });
        await events.publish({
          topic: "dns.record.created",
          aggregateType: "dns_record",
          aggregateId: String(dnsRecord.id),
          payload: dnsRecord as unknown as Record<string, unknown>,
          context
        });
      }

      const serverCertificate =
        protocol === "https"
          ? await ensureHttpsCertificateForHostname(
              repos,
              events,
              {
              dnsName,
                routeName: input.routeName.trim()
              },
              context
            )
          : null;

      const route = await repos.proxyRoutes.create({
        ...normalizeDockerRouteListener(protocol, networkInterface.address, {
          listenAddress: input.listenAddress.trim(),
          listenPort: input.listenPort
        }),
        name: input.routeName.trim(),
        protocol,
        networkInterfaceId: networkInterface.id,
        sourceHost: protocol === "http" || protocol === "https" ? dnsName : null,
        sourcePath: protocol === "http" || protocol === "https" ? normalizePath(input.sourcePath) : null,
        targetHost: target.host,
        targetPort: target.port,
        targetProtocol: resolveTargetProtocol(protocol, input.privatePort, input.publicPort),
        preserveHost: input.preserveHost,
        tlsCertPem: protocol === "https" ? serverCertificate?.certificatePem ?? null : null,
        tlsKeyPem: protocol === "https" ? serverCertificate?.privateKeyPem ?? null : null,
        enabled: input.enabled,
        healthStatus: "unknown"
      } satisfies NewProxyRoute);

      if (!route?.id) {
        throw new Error("Failed to create proxy route");
      }

      await repos.audit.create({
        action: "proxy.route.create",
        entityType: "proxy_route",
        entityId: String(route.id),
        payload: route,
        context
      });
      await events.publish({
        topic: "proxy.route.created",
        aggregateType: "proxy_route",
        aggregateId: String(route.id),
        payload: route,
        context
      });

      const created = await repos.dockerPortMappings.create({
        environmentId: input.environmentId,
        containerId: container.id,
        containerName: container.name,
        privatePort: input.privatePort,
        publicPort: input.publicPort,
        protocol: input.protocol,
        proxyRouteId: route.id
      } satisfies NewDockerPortMapping);

      await repos.audit.create({
        action: "docker.mapping.create",
        entityType: "docker_mapping",
        entityId: created?.id ? String(created.id) : null,
        payload: {
          mapping: created,
          route,
          dnsRecord,
          certificateId: serverCertificate?.id ?? null
        },
        context
      });
      if (created?.id) {
        await events.publish({
          topic: "docker.mapping.created",
          aggregateType: "docker_mapping",
          aggregateId: String(created.id),
          payload: {
            mapping: created,
            route,
            dnsRecord,
            certificateId: serverCertificate?.id ?? null
          },
          context
        });
      }
      return {
        mapping: created,
        route,
        dnsRecord,
        serverCertificate
      };
    });

    this.proxyRuntimeControl?.requestReload();
    this.dnsRuntimeControl?.requestReload();
    return mapping;
  }

  private async requireEnvironment(id: number) {
    const environment = await this.repositories.dockerEnvironments.getById(id);
    if (!environment) {
      throw new Error("Docker environment not found");
    }
    return environment;
  }

  private async audit(
    action:
      | "docker.dashboard.read"
      | "docker.environment.list"
      | "docker.container.list"
      | "docker.container.read",
    entityType: string,
    entityId: string | null,
    context: AuditContext,
    payload: Record<string, unknown>
  ) {
    await this.repositories.audit.create({
      action,
      entityType,
      entityId,
      payload,
      context
    });
  }

  private async reconcileContainerAutomap(
    environment: DockerEnvironmentEntity,
    detail: Awaited<ReturnType<typeof inspectDockerContainer>>,
    context: AuditContext,
    force = false
  ) {
    const mappings = await this.repositories.dockerPortMappings.listByEnvironment(environment.id);
    const containerMappings = mappings.filter((mapping) => mapping.containerId === detail.id);
    const existingRouteNames = (await this.repositories.proxyRoutes.list()).map((route) => route.name);
    const analysis = analyzeAutomap(
      detail,
      containerMappings,
      await this.repositories.networkInterfaces.getDefault(),
      existingRouteNames
    );
    const pending = analysis.candidates.filter((candidate) => !candidate.alreadyMapped);

    for (const issue of analysis.issues) {
      await publishContainerAutomapEventOnce(this.repositories, {
        topic: "docker.mapping.automap_failed",
        containerId: detail.id,
        payload: {
          service: issue.service,
          code: issue.code,
          message: issue.message,
          labels: issue.labels,
          signature: issue.signature
        }
      });
    }

    const created = [];
    for (const candidate of pending) {
      try {
        const createdMapping = await this.createPortMapping(
          {
            environmentId: environment.id,
            containerId: detail.id,
            privatePort: candidate.privatePort,
            publicPort: candidate.publicPort,
            protocol: candidate.protocol,
            dnsName: candidate.dnsName,
            routeName: candidate.routeName,
            routeProtocol: candidate.routeProtocol,
            networkInterfaceId: candidate.networkInterfaceId,
            listenAddress: candidate.listenAddress,
            listenPort: candidate.listenPort,
            sourcePath: candidate.sourcePath,
            preserveHost: candidate.preserveHost,
            enabled: candidate.enabled
          },
          context
        );
        created.push(createdMapping);
        await publishContainerAutomapEventOnce(this.repositories, {
          topic: "docker.mapping.automapped",
          containerId: detail.id,
          payload: {
            service: candidate.service,
            dnsName: candidate.dnsName,
            routeProtocol: candidate.routeProtocol,
            privatePort: candidate.privatePort,
            routeName: candidate.routeName,
            signature: `${candidate.service}:${candidate.dnsName}:${candidate.routeProtocol}:${candidate.privatePort}`
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown automap failure";
        const signature = `${candidate.service}:${candidate.dnsName}:${candidate.routeProtocol}:${candidate.privatePort}:${message}`;
        await publishContainerAutomapEventOnce(this.repositories, {
          topic: "docker.mapping.automap_failed",
          containerId: detail.id,
          payload: {
            service: candidate.service,
            code: "mapping_failed",
            message,
            labels: candidate.service === "default" ? ["aegis.host"] : [`aegis.${candidate.service}.host`],
            signature
          }
        });
      }
    }

    if (force || analysis.candidates.length > 0 || analysis.issues.length > 0) {
      await this.repositories.audit.create({
        action: "docker.mapping.automap",
        entityType: "docker_container",
        entityId: detail.id,
        payload: {
          environmentId: environment.id,
          detected: analysis.candidates.length,
          created: created.length,
          skipped: analysis.candidates.length - created.length,
          issues: analysis.issues.length
        },
        context
      });
    }

    return {
      containerId: detail.id,
      detected: analysis.candidates.length,
      created: created.length,
      skipped: analysis.candidates.length - created.length,
      issues: analysis.issues,
      candidates: analysis.candidates,
      mappings: created
    };
  }

  private async reconcileEnvironmentAutomaps(
    environment: DockerEnvironmentEntity,
    context: AuditContext,
    listedContainers?: Awaited<ReturnType<typeof listDockerContainers>>
  ) {
    const containers = listedContainers ?? (await listDockerContainers(environment));
    const activeContainerIds = new Set(containers.map((container) => container.id));
    const staleMappings = (await this.repositories.dockerPortMappings.listByEnvironment(environment.id)).filter(
      (mapping) => !activeContainerIds.has(mapping.containerId)
    );

    for (const mapping of staleMappings) {
      await this.repositories.db.transaction(async (trx) => {
        const repos = createRepositories(trx);
        const events = new EventBus(repos);
        await releaseMappingResources(repos, events, mapping, "container_missing", context);
      });
    }

    if (staleMappings.length > 0) {
      this.proxyRuntimeControl?.requestReload();
      this.dnsRuntimeControl?.requestReload();
    }

    for (const container of containers.filter((item) => hasAegisLabels(item.labels))) {
      const detail = await inspectDockerContainer(environment, container.id);
      await this.reconcileContainerAutomap(environment, detail, context);
    }
  }

  private async listContainerAutomapEvents(containerId: string, limit = 12) {
    const events = await this.repositories.events.list({ limit: Math.max(limit * 6, 60) });
    return events
      .filter(
        (event) =>
          event.topic.startsWith("docker.mapping.") &&
          event.aggregateType === "docker_container" &&
          event.aggregateId === containerId
      )
      .slice(0, limit);
  }

  // ─── Docker event watchers ─────────────────────────────────────────────────

  private watchers = new Map<number, () => void>();

  startWatching() {
    void this.repositories.dockerEnvironments.list().then((environments) => {
      for (const env of environments.filter((e) => e.enabled)) {
        this.startEnvironmentWatcher(env);
      }
    });
  }

  stopWatching() {
    for (const cleanup of this.watchers.values()) cleanup();
    this.watchers.clear();
  }

  private startEnvironmentWatcher(environment: DockerEnvironmentEntity) {
    this.watchers.get(environment.id)?.();

    let retryDelay = 5000;
    let retryTimer: NodeJS.Timeout | null = null;
    let stopped = false;
    let disconnectCleanup: (() => void) | null = null;

    const connect = () => {
      disconnectCleanup = watchDockerContainerEvents(
        environment,
        (event) => {
          retryDelay = 5000;
          void this.handleDockerEvent(environment, event);
        },
        (error) => {
          if (stopped) return;
          console.error(`[docker-watcher] env=${environment.id}: ${error.message}`);
          retryTimer = setTimeout(() => { if (!stopped) connect(); }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 60_000);
        }
      );
    };

    connect();

    this.watchers.set(environment.id, () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      disconnectCleanup?.();
    });
  }

  private async handleDockerEvent(environment: DockerEnvironmentEntity, event: DockerContainerEvent) {
    const context: AuditContext = {
      actorType: "system",
      actorId: "docker-watcher",
      sourceIp: null,
      userAgent: "aegis-docker-watcher"
    };

    if (event.action === "start" && hasAegisLabels(event.labels)) {
      try {
        await this.autoMapContainer(environment.id, event.containerId, context);
      } catch (error) {
        console.error(`[docker-watcher] automap failed for ${event.containerId}: ${error instanceof Error ? error.message : error}`);
      }
      return;
    }

    if (event.action === "destroy") {
      try {
        await this.releaseContainerMappings(event.containerId, context);
      } catch (error) {
        console.error(`[docker-watcher] cleanup failed for ${event.containerId}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  async deletePortMapping(mappingId: number, context: AuditContext) {
    const mapping = await this.repositories.dockerPortMappings.getById(mappingId);
    if (!mapping) throw new Error("Mapping not found");

    await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      await releaseMappingResources(repos, events, mapping, "manual", context);
    });

    this.proxyRuntimeControl?.requestReload();
    this.dnsRuntimeControl?.requestReload();
    return { deleted: mappingId };
  }

  async releaseContainerMappings(containerId: string, context: AuditContext) {
    const mappings = await this.repositories.dockerPortMappings.listByContainerId(containerId);
    if (mappings.length === 0) return { released: 0 };

    for (const mapping of mappings) {
      await this.repositories.db.transaction(async (trx) => {
        const repos = createRepositories(trx);
        const events = new EventBus(repos);
        await releaseMappingResources(repos, events, mapping, "container_removed", context);
      });
    }

    this.proxyRuntimeControl?.requestReload();
    this.dnsRuntimeControl?.requestReload();
    return { released: mappings.length };
  }
}

async function releaseMappingResources(
  repos: Repositories,
  events: EventBus,
  mapping: { id: number; proxyRouteId: number; containerId: string },
  reason: string,
  context: AuditContext
) {
  const route = mapping.proxyRouteId ? await repos.proxyRoutes.getById(mapping.proxyRouteId) : null;
  const dnsName = route?.sourceHost ?? null;

  if (route) {
    await repos.proxyRoutes.delete(route.id);
    await repos.audit.create({
      action: "proxy.route.delete",
      entityType: "proxy_route",
      entityId: String(route.id),
      payload: route,
      context
    });
    await events.publish({
      topic: "proxy.route.deleted",
      aggregateType: "proxy_route",
      aggregateId: String(route.id),
      payload: route,
      context
    });

    if (route.tlsCertPem) {
      await tryDeleteManagedCertificate(repos, route.tlsCertPem, context);
    }
  }

  if (dnsName) {
    const remainingRoutes = (await repos.proxyRoutes.list()).filter((r) => r.sourceHost === dnsName);
    if (remainingRoutes.length === 0) {
      await tryDeleteManagedDnsRecord(repos, events, dnsName, context);
    }
  }

  await repos.dockerPortMappings.deleteById(mapping.id);
  await repos.audit.create({
    action: "docker.mapping.delete",
    entityType: "docker_mapping",
    entityId: String(mapping.id),
    payload: { mappingId: mapping.id, containerId: mapping.containerId, reason },
    context
  });
  await events.publish({
    topic: "docker.mapping.deleted",
    aggregateType: "docker_mapping",
    aggregateId: String(mapping.id),
    payload: { mappingId: mapping.id, containerId: mapping.containerId, reason },
    context
  });
}

async function tryDeleteManagedCertificate(
  repos: Repositories,
  certificatePem: string,
  context: AuditContext
) {
  const cert = await repos.serverCertificates.findByCertificatePem(certificatePem);
  if (!cert) return;

  const allCerts = await repos.serverCertificates.list();
  const siblingCount = allCerts.filter((c) => c.subjectId === cert.subjectId).length;

  await repos.serverCertificates.delete(cert.id);
  await repos.audit.create({
    action: "certificate.server.delete",
    entityType: "server_certificate",
    entityId: String(cert.id),
    payload: { id: cert.id, reason: "mapping_deleted" },
    context
  });

  if (siblingCount <= 1) {
    await repos.certificateSubjects.delete(cert.subjectId);
    await repos.audit.create({
      action: "certificate.subject.delete",
      entityType: "certificate_subject",
      entityId: String(cert.subjectId),
      payload: { id: cert.subjectId, reason: "mapping_deleted" },
      context
    });
  }
}

async function tryDeleteManagedDnsRecord(
  repos: Repositories,
  events: EventBus,
  dnsName: string,
  context: AuditContext
) {
  const zones = await repos.zones.list();
  const zone = pickZoneForHostname(dnsName, zones.map((z) => ({ id: z.id, name: z.name })));
  if (!zone) return;
  const recordName = toRecordName(dnsName, zone.name);
  const record = (await repos.records.list()).find(
    (r) => r.zoneId === zone.id && r.name === recordName && r.type === "A" && r.proxiedService !== null
  );
  if (!record) return;
  await repos.records.delete(record.id);
  await repos.audit.create({
    action: "record.delete",
    entityType: "dns_record",
    entityId: String(record.id),
    payload: record as unknown as Record<string, unknown>,
    context
  });
  await events.publish({
    topic: "dns.record.deleted",
    aggregateType: "dns_record",
    aggregateId: String(record.id),
    payload: record as unknown as Record<string, unknown>,
    context
  });
}

function normalizeEnvironment(input: NewDockerEnvironment): NewDockerEnvironment {
  const connectionType = input.connectionType;
  return {
    ...input,
    name: input.name.trim(),
    publicIp: input.publicIp.trim(),
    socketPath: connectionType === "local_socket" ? input.socketPath?.trim() || "/var/run/docker.sock" : null,
    host: connectionType === "local_socket" ? null : input.host?.trim() || null,
    port: connectionType === "local_socket" ? null : input.port,
    tlsCaPem: connectionType === "tls" ? nullable(input.tlsCaPem) : null,
    tlsCertPem: connectionType === "tls" ? nullable(input.tlsCertPem) : null,
    tlsKeyPem: connectionType === "tls" ? nullable(input.tlsKeyPem) : null
  };
}

function redactEnvironment<T extends { tlsCaPem?: string | null; tlsCertPem?: string | null; tlsKeyPem?: string | null }>(value: T | null | undefined) {
  if (!value) {
    return {};
  }
  return {
    ...value,
    tlsCaPem: value.tlsCaPem ? "[redacted]" : null,
    tlsCertPem: value.tlsCertPem ? "[redacted]" : null,
    tlsKeyPem: value.tlsKeyPem ? "[redacted]" : null
  };
}

function nullable(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePath(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeDnsName(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function resolveTargetProtocol(routeProtocol: "http" | "https" | "tcp" | "udp", privatePort: number, publicPort: number | null) {
  if (routeProtocol === "http") {
    return privatePort === 443 || publicPort === 443 ? "https" : "http";
  }
  if (routeProtocol === "https") {
    return privatePort === 443 || publicPort === 443 ? "https" : "http";
  }
  return routeProtocol;
}

async function ensureDnsRecord(
  repos: Repositories,
  input: {
    dnsName: string;
    value: string;
    proxiedService: string;
  }
) {
  const zones = (await repos.zones.list()).filter((zone) => zone.enabled && zone.kind === "local");
  const zone = pickZoneForHostname(input.dnsName, zones.map((item) => ({ id: item.id, name: item.name })));
  if (!zone) {
    throw new Error(`No managed DNS zone matches ${input.dnsName}`);
  }

  const recordName = toRecordName(input.dnsName, zone.name);
  const existing = (await repos.records.list()).find(
    (record) => record.zoneId === zone.id && record.name === recordName && record.type === "A"
  );
  if (existing) {
    if (existing.value !== input.value) {
      throw new Error(`DNS record ${input.dnsName} already exists with a different address`);
    }
    return {
      record: existing,
      created: false
    };
  }

  const created = await repos.records.create({
    zoneId: zone.id,
    name: recordName,
    type: "A",
    value: input.value,
    ttl: 300,
    priority: null,
    proxiedService: input.proxiedService,
    enabled: true
  } satisfies NewRecord);

  return {
    record: created,
    created: true
  };
}

async function ensureHttpsCertificateForHostname(
  repos: Repositories,
  events: EventBus,
  input: {
    dnsName: string;
    routeName: string;
  },
  context: AuditContext
) {
  const existingServerCertificate = await findBestServerCertificateForHostname(repos, input.dnsName);
  if (existingServerCertificate) {
    return existingServerCertificate;
  }

  const existing = await findBestAcmeCertificateForHostname(repos, input.dnsName);
  if (existing) {
    return existing;
  }

  const zone = await resolveManagedZoneForHostname(repos, input.dnsName);
  if (!zone) {
    throw new Error(`No managed DNS zone matches ${input.dnsName}. Create a local zone or import the zone before creating an HTTPS mapping.`);
  }

  if (!zone.cloudflareCredentialId) {
    return issueInternalServerCertificateForHostname(repos, events, input, context);
  }

  const [account, credential] = await Promise.all([
    resolveAcmeAccount(repos),
    repos.cloudflareCredentials.getById(zone.cloudflareCredentialId)
  ]);
  if (!account) {
    throw new Error("No ACME account configured. Create an ACME account before creating HTTPS mappings.");
  }
  if (!credential) {
    throw new Error(`Cloudflare credential ${zone.cloudflareCredentialId} for zone ${zone.name} was not found`);
  }

  const material = await issueAcmeOrderMaterial(account, credential, [input.dnsName]);
  const created = await repos.acmeCertificates.create({
    name: uniqueName(`${input.routeName}-tls`, (await repos.acmeCertificates.list()).map((item) => item.name)),
    acmeAccountId: account.id,
    cloudflareCredentialId: credential.id,
    domains: [input.dnsName],
    certificatePem: material.certificatePem,
    privateKeyPem: material.privateKeyPem,
    chainPem: material.chainPem,
    serialNumber: material.serialNumber,
    issuedAt: material.issuedAt,
    expiresAt: material.expiresAt,
    renewalDays: 30,
    active: true
  });

  await repos.audit.create({
    action: "acme.certificate.issue",
    entityType: "acme_certificate",
    entityId: String(created.id),
    payload: { name: created.name, domains: created.domains, expiresAt: created.expiresAt },
    context
  });
  await events.publish({
    topic: "acme.certificate.issued",
    aggregateType: "acme_certificate",
    aggregateId: String(created.id),
    payload: { name: created.name, domains: created.domains, expiresAt: created.expiresAt },
    context
  });

  return created;
}

async function resolveManagedZoneForHostname(repos: Repositories, hostname: string) {
  const zones = (await repos.zones.list()).filter((zone) => zone.enabled && zone.kind === "local");
  return pickZoneForHostname(hostname, zones);
}

async function issueInternalServerCertificateForHostname(
  repos: Repositories,
  events: EventBus,
  input: {
    dnsName: string;
    routeName: string;
  },
  context: AuditContext
) {
  const authority = await resolveDefaultRootCertificateAuthority(repos);
  if (!authority) {
    throw new Error("No default Root CA configured. Create or bootstrap a local Root CA before creating HTTPS mappings for local zones.");
  }

  const subject = await ensureServerCertificateSubject(repos, authority.subjectId, input.dnsName);
  if (!subject) {
    throw new Error(`Failed to create certificate subject for ${input.dnsName}`);
  }
  const material = await generateServerCertificate({
    subject: {
      commonName: subject.commonName,
      organization: subject.organization,
      organizationalUnit: subject.organizationalUnit,
      country: subject.country,
      state: subject.state,
      locality: subject.locality,
      emailAddress: subject.emailAddress
    },
    validityDays: 397,
    subjectAltNames: [input.dnsName],
    issuer: {
      certificatePem: authority.certificatePem,
      privateKeyPem: authority.privateKeyPem
    }
  });

  const created = await repos.serverCertificates.create({
    name: uniqueName(`${input.routeName}-tls`, (await repos.serverCertificates.list()).map((item) => item.name)),
    subjectId: subject.id,
    caId: authority.id,
    subjectAltNames: [input.dnsName],
    certificatePem: material.certificatePem,
    privateKeyPem: material.privateKeyPem,
    chainPem: material.chainPem,
    serialNumber: material.serialNumber,
    issuedAt: material.issuedAt,
    expiresAt: material.expiresAt,
    validityDays: 397,
    renewalDays: 30,
    active: true
  } satisfies NewServerCertificate);
  if (!created) {
    throw new Error(`Failed to create server certificate for ${input.dnsName}`);
  }

  await repos.audit.create({
    action: "certificate.server.create",
    entityType: "server_certificate",
    entityId: String(created.id),
    payload: {
      ...created,
      privateKeyPem: "[redacted]"
    },
    context
  });
  await events.publish({
    topic: "certificate.server.created",
    aggregateType: "server_certificate",
    aggregateId: String(created.id),
    payload: {
      ...created,
      privateKeyPem: "[redacted]"
    },
    context
  });

  return created;
}

async function resolveDefaultRootCertificateAuthority(repos: Repositories) {
  const direct = await repos.certificateAuthorities.getDefaultRoot();
  if (direct && direct.active && direct.isSelfSigned) {
    return direct;
  }
  const fallback = (await repos.certificateAuthorities.list()).find((authority) => authority.active && authority.isSelfSigned);
  if (!fallback) {
    return null;
  }
  if (!direct || direct.id !== fallback.id) {
    await repos.certificateAuthorities.setDefaultRoot(fallback.id);
    return repos.certificateAuthorities.getById(fallback.id);
  }
  return fallback;
}

async function ensureServerCertificateSubject(repos: Repositories, parentSubjectId: number, dnsName: string) {
  const existing = (await repos.certificateSubjects.list()).find(
    (subject) => subject.parentSubjectId === parentSubjectId && subject.commonName.toLowerCase() === dnsName.toLowerCase()
  );
  if (existing) {
    return existing;
  }

  return repos.certificateSubjects.create({
    name: uniqueName(dnsName, (await repos.certificateSubjects.list()).map((item) => item.name)),
    parentSubjectId,
    parentSubjectName: null,
    commonName: dnsName,
    organization: null,
    organizationalUnit: null,
    country: null,
    state: null,
    locality: null,
    emailAddress: null
  } satisfies NewCertificateSubject);
}

async function resolveAcmeAccount(repos: Repositories) {
  const accounts = await repos.acmeAccounts.list();
  return accounts[0] ?? null;
}

async function findBestAcmeCertificateForHostname(repos: Repositories, hostname: string) {
  const now = Date.now();
  const candidates = (await repos.acmeCertificates.list())
    .filter((certificate) => certificate.active)
    .map((certificate) => ({
      certificate,
      score: getCertificateHostnameScore(certificate, hostname)
    }))
    .filter((entry) => entry.score > 0 && new Date(entry.certificate.expiresAt).getTime() > now)
    .sort((a, b) =>
      b.score - a.score ||
      new Date(b.certificate.expiresAt).getTime() - new Date(a.certificate.expiresAt).getTime()
    );
  return candidates[0]?.certificate ?? null;
}

async function findBestServerCertificateForHostname(repos: Repositories, hostname: string) {
  const now = Date.now();
  const candidates = (await repos.serverCertificates.list())
    .filter((certificate) => certificate.active)
    .map((certificate) => ({
      certificate,
      score: getServerCertificateHostnameScore(certificate, hostname)
    }))
    .filter((entry) => entry.score > 0 && new Date(entry.certificate.expiresAt).getTime() > now)
    .sort((a, b) =>
      b.score - a.score ||
      new Date(b.certificate.expiresAt).getTime() - new Date(a.certificate.expiresAt).getTime()
    );
  return candidates[0]?.certificate ?? null;
}

function getCertificateHostnameScore(certificate: AcmeCertificate, hostname: string) {
  let best = 0;
  for (const domain of certificate.domains) {
    if (domain === hostname) {
      best = Math.max(best, 10_000 + domain.length);
      continue;
    }
    if (matchesWildcardDomain(domain, hostname)) {
      best = Math.max(best, 1_000 + domain.length);
    }
  }
  return best;
}

function getServerCertificateHostnameScore(certificate: ServerCertificate, hostname: string) {
  let best = scoreHostnamePattern(certificate.commonName, hostname);
  for (const domain of certificate.subjectAltNames) {
    best = Math.max(best, scoreHostnamePattern(domain, hostname));
  }
  return best;
}

function scoreHostnamePattern(pattern: string, hostname: string) {
  if (pattern === hostname) {
    return 10_000 + pattern.length;
  }
  if (matchesWildcardDomain(pattern, hostname)) {
    return 1_000 + pattern.length;
  }
  return 0;
}

function matchesWildcardDomain(pattern: string, hostname: string) {
  if (!pattern.startsWith("*.")) {
    return false;
  }
  const base = pattern.slice(2);
  if (!hostname.endsWith(`.${base}`)) {
    return false;
  }
  return hostname.split(".").length === base.split(".").length + 1;
}

function pickZoneForHostname<T extends { id: number; name: string }>(hostname: string, zones: T[]) {
  return zones
    .filter((zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
}

function toRecordName(hostname: string, zoneName: string) {
  if (hostname === zoneName) {
    return "@";
  }
  const suffix = `.${zoneName}`;
  return hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : hostname;
}

function uniqueName(base: string, existing: string[]) {
  if (!existing.includes(base)) {
    return base;
  }
  let counter = 2;
  while (existing.includes(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}


function analyzeAutomap(
  container: {
    id: string;
    name: string;
    labels?: Record<string, string>;
    exposedPorts: Array<{
      privatePort: number;
      protocol: "tcp" | "udp";
      publishedBindings: Array<{ publicPort: number }>;
    }>;
  },
  existingMappings: Array<{
    privatePort: number;
    protocol: "tcp" | "udp";
    proxyRouteName: string | null;
  }>,
  defaultInterface: { id: number; address: string } | null,
  existingRouteNames: string[]
) {
  const labels = container.labels ?? {};
  const definitions = new Map<
    string,
    {
      host?: string;
      protocol?: string;
      port?: string;
    }
  >();

  for (const [key, rawValue] of Object.entries(labels)) {
    if (!key.startsWith("aegis.")) {
      continue;
    }
    const suffix = key.slice("aegis.".length);
    const parts = suffix.split(".");
    const field = parts[parts.length - 1];
    if (!["host", "protocol", "port"].includes(field)) {
      continue;
    }

    const service = parts.length === 1 ? "default" : parts.slice(0, -1).join(".");
    const entry = definitions.get(service) ?? {};
    entry[field as "host" | "protocol" | "port"] = rawValue.trim();
    definitions.set(service, entry);
  }

  const exposedPorts = [...container.exposedPorts].sort((left, right) => left.privatePort - right.privatePort);
  const reservedRouteNames = [...existingRouteNames];
  const sharedDefaults = definitions.get("default");
  const issues: AutomapIssue[] = [];
  const candidates: AutomapCandidate[] = [];

  for (const [service, definition] of definitions.entries()) {
    if (!definition.host && service !== "default") {
      continue;
    }

    const resolvedDefinition =
      service !== "default" && sharedDefaults
        ? {
            ...sharedDefaults,
            ...definition
          }
        : definition;

    if (!resolvedDefinition.host) {
      continue;
    }

    const selectedPort = resolveAutomapPort(exposedPorts, resolvedDefinition, service);
    if (!selectedPort) {
      issues.push(resolveAutomapIssue(service, resolvedDefinition, exposedPorts));
      continue;
    }
    if (!defaultInterface) {
      issues.push({
        service,
        severity: "error",
        code: "mapping_failed",
        message: "No default network interface configured for automapping.",
        labels: automapLabelRefs(service, []),
        signature: `${service}:missing_default_interface`
      });
      continue;
    }

    const routeProtocol = resolveAutomapRouteProtocol(service, resolvedDefinition, selectedPort, exposedPorts);
    const mappingProtocol = routeProtocol === "udp" ? "udp" : "tcp";
    if (selectedPort.protocol !== mappingProtocol) {
      issues.push({
        service,
        severity: "error",
        code: "protocol_mismatch",
        message: `Port ${selectedPort.privatePort}/${selectedPort.protocol} cannot be mapped as ${routeProtocol.toUpperCase()}.`,
        labels: automapLabelRefs(service, resolvedDefinition.protocol ? ["protocol", "port"] : ["port"]),
        signature: `${service}:protocol_mismatch:${selectedPort.privatePort}:${routeProtocol}:${selectedPort.protocol}`
      });
      continue;
    }

    const baseRouteName = service === "default" ? container.name : `${container.name}-${sanitizeServiceName(service)}`;
    const routeName = uniqueName(baseRouteName, reservedRouteNames);
    reservedRouteNames.push(routeName);
    const existing = existingMappings.find(
      (mapping) => mapping.privatePort === selectedPort.privatePort && mapping.protocol === selectedPort.protocol
    );

    candidates.push({
      service,
      dnsName: normalizeDnsName(resolvedDefinition.host),
      routeProtocol,
      privatePort: selectedPort.privatePort,
      protocol: selectedPort.protocol,
      publicPort: selectedPort.publishedBindings[0]?.publicPort ?? null,
      routeName,
      ...resolveAutomapListener(routeProtocol, selectedPort.privatePort, defaultInterface.address, defaultInterface.id),
      sourcePath: routeProtocol === "http" || routeProtocol === "https" ? "/" : null,
      preserveHost: routeProtocol === "http" || routeProtocol === "https",
      enabled: true,
      alreadyMapped: Boolean(existing),
      existingRouteName: existing?.proxyRouteName ?? null
    } satisfies AutomapCandidate);
  }

  return {
    candidates,
    issues
  };
}

function resolveAutomapPort(
  exposedPorts: Array<{
    privatePort: number;
    protocol: "tcp" | "udp";
    publishedBindings: Array<{ publicPort: number }>;
  }>,
  definition: {
    host?: string;
    protocol?: string;
    port?: string;
  },
  _service: string
) {
  if (definition.port) {
    const wantedPort = Number(definition.port);
    if (!Number.isFinite(wantedPort)) {
      return null;
    }

    const wantedTransport =
      definition.protocol === "udp" ? "udp" : definition.protocol === "tcp" ? "tcp" : definition.protocol ? "tcp" : null;

    return (
      exposedPorts.find((port) => port.privatePort === wantedPort && (!wantedTransport || port.protocol === wantedTransport)) ??
      null
    );
  }

  return exposedPorts.length === 1 ? exposedPorts[0] : null;
}

async function resolveMappingInterface(repos: Repositories, networkInterfaceId: number | null) {
  if (networkInterfaceId != null) {
    const exact = await repos.networkInterfaces.getById(networkInterfaceId);
    if (exact && exact.enabled) {
      return exact;
    }
  }

  const fallback = await repos.networkInterfaces.getDefault();
  if (!fallback) {
    throw new Error("Configure a default network interface before creating Docker mappings");
  }
  return fallback;
}

function normalizeDockerRouteListener(
  protocol: NewProxyRoute["protocol"],
  listenAddress: string,
  listener: { listenAddress: string; listenPort: number }
) {
  const canonical = getCanonicalProxyListener(protocol, listenAddress);
  return canonical ?? listener;
}

function resolveAutomapListener(routeProtocol: AutomapCandidate["routeProtocol"], privatePort: number, listenAddress: string, networkInterfaceId: number) {
  const canonical = getCanonicalProxyListener(routeProtocol, listenAddress);
  if (canonical) {
    return {
      networkInterfaceId,
      ...canonical
    };
  }
  return {
    networkInterfaceId,
    listenAddress,
    listenPort: resolveAutomapListenPort(routeProtocol, privatePort)
  };
}

function resolveAutomapRouteProtocol(
  service: string,
  definition: { protocol?: string },
  selectedPort: { protocol: "tcp" | "udp" },
  exposedPorts: Array<{ privatePort: number; protocol: "tcp" | "udp" }>
) {
  const explicit = definition.protocol?.toLowerCase();
  if (explicit === "http" || explicit === "https" || explicit === "tcp" || explicit === "udp") {
    return explicit;
  }
  if (selectedPort.protocol === "udp") {
    return "udp";
  }
  if (service === "default" && exposedPorts.length === 1) {
    return "https";
  }
  return "http";
}

function resolveAutomapListenPort(routeProtocol: "http" | "https" | "tcp" | "udp", privatePort: number) {
  if (routeProtocol === "http") {
    return 80;
  }
  if (routeProtocol === "https") {
    return 443;
  }
  return privatePort;
}

function sanitizeServiceName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "service";
}

function hasAegisLabels(labels: Record<string, string> | undefined) {
  return Object.keys(labels ?? {}).some((key) => key.startsWith("aegis."));
}

function resolveAutomapIssue(
  service: string,
  definition: { protocol?: string; port?: string },
  exposedPorts: Array<{ privatePort: number; protocol: "tcp" | "udp" }>
): AutomapIssue {
  if (definition.port) {
    const wantedPort = Number(definition.port);
    if (!Number.isFinite(wantedPort)) {
      return {
        service,
        severity: "error",
        code: "invalid_port",
        message: `Configured port "${definition.port}" is not a valid number.`,
        labels: automapLabelRefs(service, ["port"]),
        signature: `${service}:invalid_port:${definition.port}`
      };
    }

    return {
      service,
      severity: "error",
      code: "port_not_exposed",
      message: `Configured port ${wantedPort} is not exposed by the container.`,
      labels: automapLabelRefs(service, definition.protocol ? ["port", "protocol"] : ["port"]),
      signature: `${service}:port_not_exposed:${wantedPort}`
    };
  }

  return {
    service,
    severity: "error",
    code: "missing_port",
    message: `Multiple container ports are exposed. Add an explicit aegis port label for this service.`,
    labels: automapLabelRefs(service, ["host", "port"]),
    signature: `${service}:missing_port:${exposedPorts.map((item) => `${item.privatePort}/${item.protocol}`).join(",")}`
  };
}

function automapLabelRefs(service: string, fields: string[]) {
  return fields.map((field) => (service === "default" ? `aegis.${field}` : `aegis.${service}.${field}`));
}

async function publishContainerAutomapEventOnce(
  repos: Repositories,
  input: {
    topic: "docker.mapping.automapped" | "docker.mapping.automap_failed";
    containerId: string;
    payload: Record<string, unknown> & { signature: string };
  }
) {
  const recent = await repos.events.list({ limit: 120 });
  const duplicated = recent.some((event) => {
    if (event.topic !== input.topic || event.aggregateType !== "docker_container" || event.aggregateId !== input.containerId) {
      return false;
    }
    try {
      const payload = JSON.parse(event.payload) as { signature?: string };
      return payload.signature === input.payload.signature;
    } catch {
      return false;
    }
  });

  if (duplicated) {
    return;
  }

  await repos.events.create({
    topic: input.topic,
    aggregateType: "docker_container",
    aggregateId: input.containerId,
    payload: input.payload
  });
}

function resolveTarget(
  container: { networkIps: string[]; exposedPorts: Array<{ privatePort: number; protocol: "tcp" | "udp"; publishedBindings: Array<{ publicPort: number }> }> },
  publicIp: string,
  privatePort: number,
  publicPort: number | null,
  protocol: "tcp" | "udp"
) {
  if (publicPort != null) {
    return {
      host: publicIp,
      port: publicPort
    };
  }

  const matchingPort = container.exposedPorts.find((item) => item.privatePort === privatePort && item.protocol === protocol);
  const networkIp = container.networkIps[0];
  if (matchingPort && networkIp) {
    return {
      host: networkIp,
      port: privatePort
    };
  }

  throw new Error("This container port is not reachable yet. Publish it on the Docker host or ensure the container has a routable network IP.");
}
