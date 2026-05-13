export type DatabaseDriver = "postgres" | "sqlite";

export type AuditAction =
  | "bootstrap.read"
  | "bootstrap.create"
  | "bootstrap.update"
  | "dashboard.read"
  | "zone.list"
  | "zone.create"
  | "zone.update"
  | "zone.delete"
  | "record.list"
  | "record.create"
  | "record.update"
  | "record.delete"
  | "upstream.list"
  | "upstream.create"
  | "upstream.update"
  | "upstream.delete"
  | "blocklist.list"
  | "blocklist.create"
  | "blocklist.update"
  | "blocklist.delete"
  | "audit.list"
  | "event.list"
  | "runtime.status.read"
  | "runtime.metrics.read"
  | "runtime.logs.read"
  | "runtime.worker.start"
  | "runtime.worker.restart"
  | "runtime.worker.exit"
  | "runtime.worker.error"
  | "proxy.route.list"
  | "proxy.route.create"
  | "proxy.route.update"
  | "proxy.route.delete"
  | "proxy.dashboard.read"
  | "proxy.runtime.status.read"
  | "proxy.runtime.metrics.read"
  | "proxy.runtime.logs.read"
  | "proxy.runtime.worker.start"
  | "proxy.runtime.worker.restart"
  | "proxy.runtime.worker.exit"
  | "proxy.runtime.worker.error"
  | "certificate.dashboard.read"
  | "certificate.subject.list"
  | "certificate.subject.create"
  | "certificate.subject.update"
  | "certificate.subject.delete"
  | "certificate.ca.list"
  | "certificate.ca.create"
  | "certificate.ca.set_default"
  | "certificate.server.list"
  | "certificate.server.create"
  | "certificate.server.renew"
  | "certificate.server.delete"
  | "certificate.download"
  | "docker.dashboard.read"
  | "docker.environment.list"
  | "docker.environment.create"
  | "docker.environment.update"
  | "docker.environment.delete"
  | "docker.container.list"
  | "docker.container.read"
  | "docker.mapping.create"
  | "docker.mapping.delete"
  | "docker.mapping.automap"
  | "network.interface.list"
  | "network.interface.sync"
  | "api_key.create"
  | "api_key.delete"
  | "cloudflare.credential.create"
  | "cloudflare.credential.update"
  | "cloudflare.credential.delete"
  | "cloudflare.zones.import"
  | "acme.account.create"
  | "acme.account.delete"
  | "acme.certificate.issue"
  | "acme.certificate.renew"
  | "acme.certificate.delete"
  | "proxy.health.checked";

export type EventTopic =
  | "dns.bootstrap.completed"
  | "dns.zone.created"
  | "dns.zone.updated"
  | "dns.zone.deleted"
  | "dns.record.created"
  | "dns.record.updated"
  | "dns.record.deleted"
  | "dns.upstream.created"
  | "dns.upstream.updated"
  | "dns.upstream.deleted"
  | "dns.blocklist.created"
  | "dns.blocklist.updated"
  | "dns.blocklist.deleted"
  | "dns.runtime.started"
  | "dns.runtime.restarted"
  | "dns.runtime.exited"
  | "dns.runtime.error"
  | "proxy.route.created"
  | "proxy.route.updated"
  | "proxy.route.deleted"
  | "proxy.runtime.started"
  | "proxy.runtime.restarted"
  | "proxy.runtime.exited"
  | "proxy.runtime.error"
  | "certificate.subject.created"
  | "certificate.subject.updated"
  | "certificate.subject.deleted"
  | "certificate.ca.created"
  | "certificate.ca.defaulted"
  | "certificate.server.created"
  | "certificate.server.renewed"
  | "certificate.server.deleted"
  | "docker.environment.created"
  | "docker.environment.updated"
  | "docker.environment.deleted"
  | "docker.mapping.created"
  | "docker.mapping.automapped"
  | "docker.mapping.automap_failed"
  | "docker.mapping.deleted"
  | "acme.certificate.issued"
  | "acme.certificate.renewed"
  | "acme.certificate.deleted";

export interface BootstrapSettings {
  organizationName: string;
  primaryContactEmail: string;
  defaultZoneSuffix: string;
  upstreamMode: "redundant" | "strict";
  dnsListenPort: number;
  blocklistEnabled: boolean;
}

export interface BootstrapStatus {
  dnsConfigured: boolean;
  primaryCaConfigured: boolean;
  interfacesConfigured: boolean;
  completed: boolean;
}

export interface ResolverSettings extends BootstrapSettings {
  id: number;
  setupCompletedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DnsZone {
  id: number;
  name: string;
  kind: "local" | "forward";
  description: string | null;
  isPrimary: boolean;
  isReverse: boolean;
  ttl: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DnsRecord {
  id: number;
  zoneId: number;
  name: string;
  type: "A" | "AAAA" | "CNAME" | "TXT" | "MX" | "SRV";
  value: string;
  ttl: number;
  priority: number | null;
  proxiedService: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DnsUpstream {
  id: number;
  name: string;
  address: string;
  port: number;
  protocol: "udp" | "tcp" | "https" | "tls";
  enabled: boolean;
  priority: number;
  healthStatus: "unknown" | "healthy" | "degraded";
  createdAt: string;
  updatedAt: string;
}

export interface BlocklistEntry {
  id: number;
  pattern: string;
  kind: "domain" | "suffix" | "regex";
  source: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkInterface {
  id: number;
  name: string;
  address: string;
  family: "ipv4" | "ipv6";
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseContext {
  driver: DatabaseDriver;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ lastInsertId?: number }>;
  transaction<T>(callback: (trx: DatabaseContext) => Promise<T>): Promise<T>;
}

export const API_SCOPES = [
  "admin",
  "dns:read", "dns:write",
  "proxy:read", "proxy:write",
  "docker:read", "docker:write",
  "ca:read", "ca:write"
] as const;

export type ApiScope = typeof API_SCOPES[number];

export interface ApiKey {
  id: number;
  name: string;
  keyHash: string;
  scopes: ApiScope[];
  createdBy: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudflareCredential {
  id: number;
  name: string;
  apiToken: string;
  createdAt: string;
  updatedAt: string;
}

export interface AcmeAccount {
  id: number;
  name: string;
  email: string;
  directoryUrl: string;
  accountKeyPem: string;
  accountUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AcmeCertificate {
  id: number;
  name: string;
  acmeAccountId: number;
  acmeAccountName: string;
  cloudflareCredentialId: number;
  cloudflareCredentialName: string;
  domains: string[];
  certificatePem: string;
  privateKeyPem: string;
  chainPem: string;
  serialNumber: string;
  issuedAt: string;
  expiresAt: string;
  renewalDays: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuditContext {
  actorType: "system" | "user" | "api_client";
  actorId: string;
  sourceIp: string | null;
  userAgent: string | null;
}

export interface AuditLogEntry {
  id: number;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  actorType: AuditContext["actorType"];
  actorId: string;
  sourceIp: string | null;
  userAgent: string | null;
  payload: string | null;
  createdAt: string;
}

export interface DomainEvent {
  id: number;
  topic: EventTopic;
  aggregateType: string;
  aggregateId: string;
  payload: string;
  metadata: string | null;
  createdAt: string;
}

export interface DnsQueryLogEntry {
  id: number;
  protocol: "udp" | "tcp";
  clientIp: string | null;
  questionName: string;
  questionType: string;
  resolutionMode: "authoritative" | "upstream" | "cached" | "blocked" | "nxdomain" | "servfail";
  responseCode: string;
  answerCount: number;
  durationMs: number;
  zoneName: string | null;
  upstreamName: string | null;
  createdAt: string;
}

export interface DnsRuntimeMetrics {
  totalQueries: number;
  authoritativeQueries: number;
  upstreamQueries: number;
  cachedQueries: number;
  blockedQueries: number;
  nxDomainQueries: number;
  servfailQueries: number;
  avgDurationMs: number;
  lastQueryAt: string | null;
  cacheSize: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface DnsRuntimeStatus {
  state: "starting" | "running" | "idle" | "error" | "stopped";
  pid: number | null;
  restarts: number;
  lastStartedAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  listening: {
    udpPort: number | null;
    tcpPort: number | null;
    address: string | null;
  };
}

export interface ProxyRoute {
  id: number;
  name: string;
  protocol: "http" | "https" | "tcp" | "udp";
  networkInterfaceId: number | null;
  listenAddress: string;
  listenPort: number;
  sourceHost: string | null;
  sourcePath: string | null;
  targetHost: string;
  targetPort: number;
  targetProtocol: "http" | "https" | "tcp" | "udp";
  preserveHost: boolean;
  tlsCertPem: string | null;
  tlsKeyPem: string | null;
  healthStatus: "unknown" | "healthy" | "degraded";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyRequestLogEntry {
  id: number;
  routeId: number | null;
  routeName: string | null;
  protocol: "http" | "https" | "tcp" | "udp";
  clientIp: string | null;
  targetHost: string | null;
  targetPort: number | null;
  outcome: "proxied" | "rejected" | "error";
  statusCode: number | null;
  bytesIn: number;
  bytesOut: number;
  durationMs: number;
  metadata: string | null;
  createdAt: string;
}

export interface ProxyRuntimeMetrics {
  totalRequests: number;
  httpRequests: number;
  httpsRequests: number;
  tcpSessions: number;
  udpPackets: number;
  errors: number;
  avgDurationMs: number;
  lastActivityAt: string | null;
}

export interface CertificateSubject {
  id: number;
  name: string;
  parentSubjectId: number | null;
  parentSubjectName: string | null;
  commonName: string;
  organization: string | null;
  organizationalUnit: string | null;
  country: string | null;
  state: string | null;
  locality: string | null;
  emailAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateAuthority {
  id: number;
  name: string;
  subjectId: number;
  issuerCaId: number | null;
  subjectName: string;
  issuerName: string | null;
  commonName: string;
  certificatePem: string;
  privateKeyPem: string;
  serialNumber: string;
  issuedAt: string;
  expiresAt: string;
  validityDays: number;
  pathLength: number | null;
  isSelfSigned: boolean;
  isDefault: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServerCertificate {
  id: number;
  name: string;
  subjectId: number;
  caId: number;
  subjectName: string;
  caName: string;
  commonName: string;
  subjectAltNames: string[];
  certificatePem: string;
  privateKeyPem: string;
  chainPem: string;
  serialNumber: string;
  issuedAt: string;
  expiresAt: string;
  validityDays: number;
  renewalDays: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DockerEnvironment {
  id: number;
  name: string;
  connectionType: "local_socket" | "tcp" | "tls";
  socketPath: string | null;
  host: string | null;
  port: number | null;
  tlsCaPem: string | null;
  tlsCertPem: string | null;
  tlsKeyPem: string | null;
  publicIp: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DockerPortMapping {
  id: number;
  environmentId: number;
  containerId: string;
  containerName: string;
  privatePort: number;
  publicPort: number | null;
  protocol: "tcp" | "udp";
  proxyRouteId: number;
  proxyRouteName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyRuntimeStatus {
  state: "starting" | "running" | "idle" | "error" | "stopped";
  pid: number | null;
  restarts: number;
  lastStartedAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  listeners: Array<{
    protocol: "http" | "https" | "tcp" | "udp";
    address: string;
    port: number;
    routeCount: number;
  }>;
}
