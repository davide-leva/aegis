import { EventBus } from "../events/event-bus.js";
import { generateServerCertificate } from "../lib/pki.js";
import type { NewCertificateSubject } from "../repositories/certificate-subject-repository.js";
import type { NewServerCertificate } from "../repositories/server-certificate-repository.js";
import type { Repositories } from "../repositories/index.js";
import { issueAcmeOrderMaterial } from "./acme-service.js";
import type { AcmeCertificate, AuditContext, DnsZone, ServerCertificate } from "../types.js";

type HostnameCertificate = AcmeCertificate | ServerCertificate;

export async function ensureTlsMaterialForHostname(
  repos: Repositories,
  events: EventBus,
  input: {
    dnsName: string;
    routeName: string;
  },
  context: AuditContext
): Promise<HostnameCertificate> {
  const existingServerCertificate = await findBestServerCertificateForHostname(repos, input.dnsName);
  if (existingServerCertificate) {
    return existingServerCertificate;
  }

  const existingAcmeCertificate = await findBestAcmeCertificateForHostname(repos, input.dnsName);
  if (existingAcmeCertificate) {
    return existingAcmeCertificate;
  }

  const zone = await resolveManagedZoneForHostname(repos, input.dnsName);
  if (zone?.cloudflareCredentialId) {
    const [account, credential] = await Promise.all([
      resolveAcmeAccount(repos),
      repos.cloudflareCredentials.getById(zone.cloudflareCredentialId)
    ]);
    if (!account) {
      throw new Error("No ACME account configured. Create an ACME account before creating HTTPS routes for managed public hostnames.");
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

  return issueInternalServerCertificateForHostname(repos, events, input, context);
}

export async function resolveRootCertificateAuthority(repos: Repositories) {
  const roots = (await repos.certificateAuthorities.list())
    .filter((authority) => authority.active && authority.isSelfSigned)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return roots[0] ?? null;
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
  const authority = await resolveRootCertificateAuthority(repos);
  if (!authority) {
    throw new Error("No active Root CA configured. Create or bootstrap a local Root CA before creating HTTPS routes for unmanaged hostnames.");
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

async function resolveManagedZoneForHostname(repos: Repositories, hostname: string) {
  const zones = (await repos.zones.list()).filter((zone) => zone.enabled && zone.kind === "local");
  return pickZoneForHostname(hostname, zones);
}

function pickZoneForHostname<T extends Pick<DnsZone, "id" | "name">>(hostname: string, zones: T[]) {
  return zones
    .filter((zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
}
