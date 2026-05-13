import type { DatabaseContext } from "../types.js";
import { AcmeAccountRepository } from "./acme-account-repository.js";
import { ConfigRepository } from "./config-repository.js";
import { AcmeCertificateRepository } from "./acme-certificate-repository.js";
import { ApiKeyRepository } from "./api-key-repository.js";
import { AuditRepository } from "./audit-repository.js";
import { BlocklistRepository } from "./blocklist-repository.js";
import { CertificateAuthorityRepository } from "./certificate-authority-repository.js";
import { CertificateSubjectRepository } from "./certificate-subject-repository.js";
import { CloudflareCredentialRepository } from "./cloudflare-credential-repository.js";
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
import { UserRepository } from "./user-repository.js";

export function createRepositories(db: DatabaseContext) {
  return {
    db,
    users: new UserRepository(db),
    apiKeys: new ApiKeyRepository(db),
    cloudflareCredentials: new CloudflareCredentialRepository(db),
    acmeAccounts: new AcmeAccountRepository(db),
    acmeCertificates: new AcmeCertificateRepository(db),
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
    config: new ConfigRepository(db),
    audit: new AuditRepository(db),
    events: new EventRepository(db)
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
