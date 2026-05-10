import { EventBus } from "../events/event-bus.js";
import { generateServerCertificate } from "../lib/pki.js";
import { inspectDockerContainer, listDockerContainers } from "../lib/docker-api.js";
import type { AuditContext, DockerEnvironment as DockerEnvironmentEntity } from "../types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type { NewCertificateSubject } from "../repositories/certificate-subject-repository.js";
import type { NewDockerEnvironment } from "../repositories/docker-environment-repository.js";
import type { NewDockerPortMapping } from "../repositories/docker-port-mapping-repository.js";
import type { NewProxyRoute } from "../repositories/proxy-route-repository.js";
import type { NewRecord } from "../repositories/dns-record-repository.js";
import type { NewServerCertificate } from "../repositories/server-certificate-repository.js";

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
    private readonly eventBus: EventBus,
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
      const existing = await repos.dockerEnvironments.delete(id);
      if (!existing) {
        throw new Error("Docker environment not found");
      }
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

    const containerMappings = mappings.filter((mapping) => mapping.containerId === detail.id);
    const automapAnalysis = analyzeAutomap(detail, containerMappings);
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

      const container = await inspectDockerContainer(environment, input.containerId);
      const target = resolveTarget(container, environment.publicIp, input.privatePort, input.publicPort, input.protocol);
      const protocol = input.routeProtocol;
      const dnsName = normalizeDnsName(input.dnsName);
      const defaultRoot = protocol === "https" ? await resolveDefaultRootCertificateAuthority(repos) : null;
      if (protocol === "https" && !defaultRoot) {
        throw new Error("No default Root CA available for HTTPS mappings");
      }

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
          ? await ensureServerCertificateForHostname(repos, {
              dnsName,
              routeName: input.routeName.trim(),
              certificateAuthorityId: defaultRoot!.id
            })
          : null;
      if (serverCertificate?.id) {
        const redactedCertificate = redactServerCertificate(serverCertificate) ?? {};
        await repos.audit.create({
          action: "certificate.server.create",
          entityType: "server_certificate",
          entityId: String(serverCertificate.id),
          payload: redactedCertificate,
          context
        });
        await events.publish({
          topic: "certificate.server.created",
          aggregateType: "server_certificate",
          aggregateId: String(serverCertificate.id),
          payload: redactedCertificate,
          context
        });
      }

      const route = await repos.proxyRoutes.create({
        name: input.routeName.trim(),
        protocol,
        listenAddress: input.listenAddress.trim(),
        listenPort: input.listenPort,
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
    const analysis = analyzeAutomap(detail, containerMappings);
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
    for (const container of containers.filter((item) => hasAegisLabels(item.labels))) {
      const detail = await inspectDockerContainer(environment, container.id);
      await this.reconcileContainerAutomap(environment, detail, context);
    }
  }

  private async listContainerAutomapEvents(containerId: string, limit = 12) {
    const events = await this.repositories.events.list(Math.max(limit * 6, 60));
    return events
      .filter(
        (event) =>
          event.topic.startsWith("docker.mapping.") &&
          event.aggregateType === "docker_container" &&
          event.aggregateId === containerId
      )
      .slice(0, limit);
  }
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

async function resolveDefaultRootCertificateAuthority(repos: Repositories) {
  const direct = await repos.certificateAuthorities.getDefaultRoot();
  if (direct && direct.active && direct.isSelfSigned) {
    return direct;
  }

  const fallback = (await repos.certificateAuthorities.list()).find((authority) => authority.active && authority.isSelfSigned) ?? null;
  if (fallback?.id && (!direct || direct.id !== fallback.id)) {
    await repos.certificateAuthorities.setDefaultRoot(fallback.id);
    return repos.certificateAuthorities.getById(fallback.id);
  }
  return fallback;
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

async function ensureServerCertificateForHostname(
  repos: Repositories,
  input: {
    dnsName: string;
    routeName: string;
    certificateAuthorityId: number;
  }
) {
  const authority = await repos.certificateAuthorities.getById(input.certificateAuthorityId);
  if (!authority) {
    throw new Error("Default Root CA not found");
  }
  const parentSubject = await repos.certificateSubjects.getById(authority.subjectId);
  if (!parentSubject) {
    throw new Error("Default Root CA subject not found");
  }

  const subjectName = uniqueName(`${input.routeName}-subject`, (await repos.certificateSubjects.list()).map((item) => item.name));
  const subject = await repos.certificateSubjects.create({
    name: subjectName,
    parentSubjectId: parentSubject.id,
    parentSubjectName: parentSubject.name,
    commonName: input.dnsName,
    organization: parentSubject.organization,
    organizationalUnit: "Docker Publishing",
    country: parentSubject.country,
    state: parentSubject.state,
    locality: parentSubject.locality,
    emailAddress: parentSubject.emailAddress
  } satisfies NewCertificateSubject);

  if (!subject) {
    throw new Error("Failed to create certificate subject");
  }

  const material = await generateServerCertificate({
    subject,
    validityDays: 397,
    subjectAltNames: [input.dnsName],
    issuer: {
      certificatePem: authority.certificatePem,
      privateKeyPem: authority.privateKeyPem
    }
  });

  return repos.serverCertificates.create({
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
}

function pickZoneForHostname(hostname: string, zones: Array<{ id: number; name: string }>) {
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

function redactServerCertificate<T extends { privateKeyPem?: string | null }>(value: T | null | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  return {
    ...value,
    privateKeyPem: value.privateKeyPem ? "[redacted]" : null
  };
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
  }>
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
  const existingNames = existingMappings.map((mapping) => mapping.proxyRouteName).filter(Boolean) as string[];
  const sharedDefaults = definitions.get("default");
  const issues: AutomapIssue[] = [];

  const candidates = Array.from(definitions.entries())
    .filter(([service, definition]) => definition.host || (service === "default" && definition.host))
    .flatMap(([service, definition]) => {
      const resolvedDefinition =
        service !== "default" && sharedDefaults
          ? {
              ...sharedDefaults,
              ...definition
            }
          : definition;

      if (!resolvedDefinition.host) {
        return [];
      }

      const selectedPort = resolveAutomapPort(exposedPorts, resolvedDefinition, service);
      if (!selectedPort) {
        issues.push(resolveAutomapIssue(service, resolvedDefinition, exposedPorts));
        return [];
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
        return [];
      }

      const baseRouteName = service === "default" ? container.name : `${container.name}-${sanitizeServiceName(service)}`;
      const routeName = uniqueName(baseRouteName, existingNames);
      const existing = existingMappings.find(
        (mapping) => mapping.privatePort === selectedPort.privatePort && mapping.protocol === selectedPort.protocol
      );

      return [
        {
          service,
          dnsName: normalizeDnsName(resolvedDefinition.host),
          routeProtocol,
          privatePort: selectedPort.privatePort,
          protocol: selectedPort.protocol,
          publicPort: selectedPort.publishedBindings[0]?.publicPort ?? null,
          routeName,
          listenAddress: "0.0.0.0",
          listenPort: resolveAutomapListenPort(routeProtocol, selectedPort.privatePort),
          sourcePath: routeProtocol === "http" || routeProtocol === "https" ? "/" : null,
          preserveHost: routeProtocol === "http" || routeProtocol === "https",
          enabled: true,
          alreadyMapped: Boolean(existing),
          existingRouteName: existing?.proxyRouteName ?? null
        } satisfies AutomapCandidate
      ];
    });

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
  const recent = await repos.events.list(120);
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
