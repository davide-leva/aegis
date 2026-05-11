import type { DatabaseContext } from "../types.js";
import { AuditRepository } from "./audit-repository.js";
import { BlocklistRepository } from "./blocklist-repository.js";
import { CertificateAuthorityRepository } from "./certificate-authority-repository.js";
import { CertificateSubjectRepository } from "./certificate-subject-repository.js";
import { DnsRecordRepository } from "./dns-record-repository.js";
import { DnsQueryLogRepository } from "./dns-query-log-repository.js";
import { DnsUpstreamRepository } from "./dns-upstream-repository.js";
import { DnsZoneRepository } from "./dns-zone-repository.js";
import { DockerEnvironmentRepository } from "./docker-environment-repository.js";
import { DockerPortMappingRepository } from "./docker-port-mapping-repository.js";
import { EventRepository } from "./event-repository.js";
import { NetworkInterfaceRepository } from "./network-interface-repository.js";
import { ProxyRequestLogRepository } from "./proxy-request-log-repository.js";
import { ProxyRouteRepository } from "./proxy-route-repository.js";
import { ResolverSettingsRepository } from "./resolver-settings-repository.js";
import { ServerCertificateRepository } from "./server-certificate-repository.js";

export function createRepositories(db: DatabaseContext) {
  return {
    db,
    resolverSettings: new ResolverSettingsRepository(db),
    certificateSubjects: new CertificateSubjectRepository(db),
    certificateAuthorities: new CertificateAuthorityRepository(db),
    serverCertificates: new ServerCertificateRepository(db),
    dockerEnvironments: new DockerEnvironmentRepository(db),
    dockerPortMappings: new DockerPortMappingRepository(db),
    networkInterfaces: new NetworkInterfaceRepository(db),
    zones: new DnsZoneRepository(db),
    records: new DnsRecordRepository(db),
    queryLogs: new DnsQueryLogRepository(db),
    upstreams: new DnsUpstreamRepository(db),
    blocklist: new BlocklistRepository(db),
    proxyRoutes: new ProxyRouteRepository(db),
    proxyLogs: new ProxyRequestLogRepository(db),
    audit: new AuditRepository(db),
    events: new EventRepository(db)
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
