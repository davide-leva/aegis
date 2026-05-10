import { EventBus } from "../events/event-bus.js";
import { generateCertificateAuthority, generateServerCertificate } from "../lib/pki.js";
import type { AuditContext } from "../types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type { NewCertificateAuthority } from "../repositories/certificate-authority-repository.js";
import type { NewCertificateSubject } from "../repositories/certificate-subject-repository.js";
import type { NewServerCertificate } from "../repositories/server-certificate-repository.js";

export type CreateCertificateSubjectInput = {
  name: string;
  parentSubjectId: number | null;
  commonName: string | null;
  organization: string | null;
  organizationalUnit: string | null;
  country: string | null;
  state: string | null;
  locality: string | null;
  emailAddress: string | null;
};

export type CreateCertificateAuthorityInput = {
  name: string;
  subjectId: number;
  issuerCaId: number | null;
  validityDays: number;
  pathLength: number | null;
  isDefault: boolean;
  active: boolean;
};

export type CreateServerCertificateInput = {
  name: string;
  subjectId: number;
  caId: number;
  subjectAltNames: string[];
  validityDays: number;
  renewalDays: number;
  active: boolean;
};

export class CertificateService {
  constructor(
    private readonly repositories: Repositories,
    private readonly eventBus: EventBus
  ) {}

  async getDashboard(context: AuditContext) {
    const [subjects, authorities, serverCertificates] = await Promise.all([
      this.repositories.certificateSubjects.list(),
      this.repositories.certificateAuthorities.list(),
      this.repositories.serverCertificates.list()
    ]);

    const now = Date.now();
    const expiringSoon = serverCertificates.filter((certificate) => {
      const diffDays = Math.ceil((new Date(certificate.expiresAt).getTime() - now) / 86400000);
      return diffDays <= certificate.renewalDays;
    }).length;

    const dashboard = {
      summary: {
        subjects: subjects.length,
        certificateAuthorities: authorities.length,
        serverCertificates: serverCertificates.length,
        expiringSoon
      },
      subjects,
      certificateAuthorities: authorities,
      serverCertificates
    };

    await this.audit("certificate.dashboard.read", "certificate_dashboard", null, context, dashboard.summary);
    return dashboard;
  }

  async listSubjects(context: AuditContext) {
    const subjects = await this.repositories.certificateSubjects.list();
    await this.audit("certificate.subject.list", "certificate_subject", null, context, { count: subjects.length });
    return subjects;
  }

  async createSubject(input: CreateCertificateSubjectInput, context: AuditContext) {
    const subject = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const created = await repos.certificateSubjects.create(await resolveSubjectInput(normalizeSubjectDraft(input), repos));
      await repos.audit.create({
        action: "certificate.subject.create",
        entityType: "certificate_subject",
        entityId: created?.id ? String(created.id) : null,
        payload: created ?? null,
        context
      });
      if (created?.id) {
        await events.publish({
          topic: "certificate.subject.created",
          aggregateType: "certificate_subject",
          aggregateId: String(created.id),
          payload: created,
          context
        });
      }
      return created;
    });
    return subject;
  }

  async updateSubject(id: number, input: CreateCertificateSubjectInput, context: AuditContext) {
    const subject = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.certificateSubjects.getById(id);
      if (!existing) {
        throw new Error("Certificate subject not found");
      }
      const updated = await repos.certificateSubjects.update(id, await resolveSubjectInput(normalizeSubjectDraft(input), repos, id));
      await repos.audit.create({
        action: "certificate.subject.update",
        entityType: "certificate_subject",
        entityId: String(id),
        payload: { before: existing, after: updated },
        context
      });
      if (updated) {
        await events.publish({
          topic: "certificate.subject.updated",
          aggregateType: "certificate_subject",
          aggregateId: String(id),
          payload: updated,
          context
        });
      }
      return updated;
    });
    return subject;
  }

  async deleteSubject(id: number, context: AuditContext) {
    const subject = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.certificateSubjects.getById(id);
      if (!existing) {
        throw new Error("Certificate subject not found");
      }

      const [authorities, serverCertificates] = await Promise.all([
        repos.certificateAuthorities.list(),
        repos.serverCertificates.list()
      ]);
      if (authorities.some((authority) => authority.subjectId === id) || serverCertificates.some((certificate) => certificate.subjectId === id)) {
        throw new Error("Certificate subject is already in use");
      }
      if ((await repos.certificateSubjects.list()).some((subject) => subject.parentSubjectId === id)) {
        throw new Error("Certificate subject has child subjects");
      }

      const deleted = await repos.certificateSubjects.delete(id);
      await repos.audit.create({
        action: "certificate.subject.delete",
        entityType: "certificate_subject",
        entityId: String(id),
        payload: deleted,
        context
      });
      await events.publish({
        topic: "certificate.subject.deleted",
        aggregateType: "certificate_subject",
        aggregateId: String(id),
        payload: deleted ?? {},
        context
      });
      return deleted;
    });
    return subject;
  }

  async listCertificateAuthorities(context: AuditContext) {
    const authorities = await this.repositories.certificateAuthorities.list();
    await this.audit("certificate.ca.list", "certificate_authority", null, context, { count: authorities.length });
    return authorities;
  }

  async createCertificateAuthority(input: CreateCertificateAuthorityInput, context: AuditContext) {
    const authority = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const subject = await repos.certificateSubjects.getById(input.subjectId);
      if (!subject) {
        throw new Error("Certificate subject not found");
      }
      if (input.issuerCaId == null && subject.parentSubjectId != null) {
        throw new Error("Root CAs must use a root subject");
      }

      const issuer = input.issuerCaId == null ? null : await repos.certificateAuthorities.getById(input.issuerCaId);
      if (input.issuerCaId != null && !issuer) {
        throw new Error("Issuer CA not found");
      }

      const shouldBeDefault =
        input.issuerCaId == null &&
        (input.isDefault || !(await repos.certificateAuthorities.getDefaultRoot()));

      const material = await generateCertificateAuthority({
        subject,
        validityDays: input.validityDays,
        pathLength: input.pathLength,
        issuer: issuer
          ? {
              certificatePem: issuer.certificatePem,
              privateKeyPem: issuer.privateKeyPem
            }
          : null
      });

      const created = await repos.certificateAuthorities.create({
        name: input.name.trim(),
        subjectId: input.subjectId,
        issuerCaId: input.issuerCaId,
        certificatePem: material.certificatePem,
        privateKeyPem: material.privateKeyPem,
        serialNumber: material.serialNumber,
        issuedAt: material.issuedAt,
        expiresAt: material.expiresAt,
        validityDays: input.validityDays,
        pathLength: input.pathLength,
        isSelfSigned: input.issuerCaId == null,
        isDefault: shouldBeDefault,
        active: input.active
      } satisfies NewCertificateAuthority);

      if (shouldBeDefault && created?.id) {
        await repos.certificateAuthorities.setDefaultRoot(created.id);
      }

      await repos.audit.create({
        action: "certificate.ca.create",
        entityType: "certificate_authority",
        entityId: created?.id ? String(created.id) : null,
        payload: {
          ...created,
          privateKeyPem: "[redacted]"
        },
        context
      });
      if (created?.id) {
        await events.publish({
          topic: "certificate.ca.created",
          aggregateType: "certificate_authority",
          aggregateId: String(created.id),
          payload: {
            ...created,
            privateKeyPem: "[redacted]"
          },
          context
        });
      }
      return created;
    });
    return authority;
  }

  async listServerCertificates(context: AuditContext) {
    const certificates = await this.repositories.serverCertificates.list();
    await this.audit("certificate.server.list", "server_certificate", null, context, { count: certificates.length });
    return certificates;
  }

  async getDefaultRootCertificateAuthority() {
    const direct = await this.repositories.certificateAuthorities.getDefaultRoot();
    if (direct && direct.active && direct.isSelfSigned) {
      return direct;
    }

    const fallback = (await this.repositories.certificateAuthorities.list()).find((authority) => authority.active && authority.isSelfSigned) ?? null;
    if (fallback?.id && (!direct || direct.id !== fallback.id)) {
      await this.repositories.certificateAuthorities.setDefaultRoot(fallback.id);
      return this.repositories.certificateAuthorities.getById(fallback.id);
    }
    return fallback;
  }

  async createServerCertificate(input: CreateServerCertificateInput, context: AuditContext) {
    const certificate = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const normalizedInput = normalizeServerCertificateInput(input);
      const subject = await repos.certificateSubjects.getById(normalizedInput.subjectId);
      if (!subject) {
        throw new Error("Certificate subject not found");
      }
      const authority = await repos.certificateAuthorities.getById(normalizedInput.caId);
      if (!authority) {
        throw new Error("Certificate authority not found");
      }

      const material = await generateServerCertificate({
        subject,
        validityDays: normalizedInput.validityDays,
        subjectAltNames: normalizedInput.subjectAltNames,
        issuer: {
          certificatePem: authority.certificatePem,
          privateKeyPem: authority.privateKeyPem
        }
      });

      const created = await repos.serverCertificates.create({
        name: normalizedInput.name,
        subjectId: normalizedInput.subjectId,
        caId: normalizedInput.caId,
        subjectAltNames: normalizedInput.subjectAltNames,
        certificatePem: material.certificatePem,
        privateKeyPem: material.privateKeyPem,
        chainPem: material.chainPem,
        serialNumber: material.serialNumber,
        issuedAt: material.issuedAt,
        expiresAt: material.expiresAt,
        validityDays: normalizedInput.validityDays,
        renewalDays: normalizedInput.renewalDays,
        active: normalizedInput.active
      } satisfies NewServerCertificate);

      await repos.audit.create({
        action: "certificate.server.create",
        entityType: "server_certificate",
        entityId: created?.id ? String(created.id) : null,
        payload: redactServerCertificate(created),
        context
      });
      if (created?.id) {
        await events.publish({
          topic: "certificate.server.created",
          aggregateType: "server_certificate",
          aggregateId: String(created.id),
          payload: redactServerCertificate(created),
          context
        });
      }
      return created;
    });
    return certificate;
  }

  async renewServerCertificate(id: number, context: AuditContext) {
    const certificate = await this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const events = new EventBus(repos);
      const existing = await repos.serverCertificates.getById(id);
      if (!existing) {
        throw new Error("Server certificate not found");
      }

      const [subject, authority] = await Promise.all([
        repos.certificateSubjects.getById(existing.subjectId),
        repos.certificateAuthorities.getById(existing.caId)
      ]);
      if (!subject) {
        throw new Error("Certificate subject not found");
      }
      if (!authority) {
        throw new Error("Certificate authority not found");
      }

      const material = await generateServerCertificate({
        subject,
        validityDays: existing.validityDays,
        subjectAltNames: existing.subjectAltNames,
        issuer: {
          certificatePem: authority.certificatePem,
          privateKeyPem: authority.privateKeyPem
        }
      });

      const renewed = await repos.serverCertificates.updateMaterial(id, {
        name: existing.name,
        subjectId: existing.subjectId,
        caId: existing.caId,
        subjectAltNames: existing.subjectAltNames,
        certificatePem: material.certificatePem,
        privateKeyPem: material.privateKeyPem,
        chainPem: material.chainPem,
        serialNumber: material.serialNumber,
        issuedAt: material.issuedAt,
        expiresAt: material.expiresAt,
        validityDays: existing.validityDays,
        renewalDays: existing.renewalDays,
        active: existing.active
      });

      await repos.audit.create({
        action: "certificate.server.renew",
        entityType: "server_certificate",
        entityId: String(id),
        payload: {
          before: redactServerCertificate(existing),
          after: redactServerCertificate(renewed)
        },
        context
      });
      if (renewed) {
        await events.publish({
          topic: "certificate.server.renewed",
          aggregateType: "server_certificate",
          aggregateId: String(id),
          payload: redactServerCertificate(renewed),
          context
        });
      }
      return renewed;
    });
    return certificate;
  }

  async downloadCertificateAuthority(id: number, kind: "certificate" | "key", context: AuditContext) {
    const authority = await this.repositories.certificateAuthorities.getById(id);
    if (!authority) {
      throw new Error("Certificate authority not found");
    }
    await this.audit("certificate.download", "certificate_authority", String(id), context, { kind });
    return {
      fileName: `${authority.name}.${kind === "certificate" ? "crt.pem" : "key.pem"}`,
      contents: kind === "certificate" ? authority.certificatePem : authority.privateKeyPem
    };
  }

  async downloadServerCertificate(id: number, kind: "certificate" | "key" | "chain", context: AuditContext) {
    const certificate = await this.repositories.serverCertificates.getById(id);
    if (!certificate) {
      throw new Error("Server certificate not found");
    }
    await this.audit("certificate.download", "server_certificate", String(id), context, { kind });
    return {
      fileName: `${certificate.name}.${kind === "certificate" ? "crt.pem" : kind === "chain" ? "chain.pem" : "key.pem"}`,
      contents:
        kind === "certificate" ? certificate.certificatePem : kind === "chain" ? certificate.chainPem : certificate.privateKeyPem
    };
  }

  private async audit(
    action:
      | "certificate.dashboard.read"
      | "certificate.subject.list"
      | "certificate.ca.list"
      | "certificate.server.list"
      | "certificate.download",
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
}

function normalizeSubjectDraft(input: CreateCertificateSubjectInput): CreateCertificateSubjectInput {
  return {
    ...input,
    name: input.name.trim(),
    commonName: nullable(input.commonName),
    organization: nullable(input.organization),
    organizationalUnit: nullable(input.organizationalUnit),
    country: nullable(input.country)?.toUpperCase() ?? null,
    state: nullable(input.state),
    locality: nullable(input.locality),
    emailAddress: nullable(input.emailAddress)
  };
}

async function resolveSubjectInput(
  input: CreateCertificateSubjectInput,
  repos: Repositories,
  currentId?: number
): Promise<NewCertificateSubject> {
  if (input.parentSubjectId === currentId) {
    throw new Error("A subject cannot inherit from itself");
  }

  const parent = input.parentSubjectId == null ? null : await repos.certificateSubjects.getById(input.parentSubjectId);
  if (input.parentSubjectId != null && !parent) {
    throw new Error("Parent subject not found");
  }

  const commonName = input.commonName ?? parent?.commonName ?? null;
  if (!commonName) {
    throw new Error("Common name is required");
  }

  const resolved: NewCertificateSubject = {
    name: input.name,
    parentSubjectId: input.parentSubjectId,
    commonName,
    organization: input.organization ?? parent?.organization ?? null,
    organizationalUnit: input.organizationalUnit ?? parent?.organizationalUnit ?? null,
    country: input.country ?? parent?.country ?? null,
    state: input.state ?? parent?.state ?? null,
    locality: input.locality ?? parent?.locality ?? null,
    emailAddress: input.emailAddress ?? parent?.emailAddress ?? null,
    parentSubjectName: parent?.name ?? null
  };

  return resolved;
}

function normalizeServerCertificateInput(input: CreateServerCertificateInput): CreateServerCertificateInput {
  const subjectAltNames = Array.from(
    new Set(
      input.subjectAltNames
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    )
  );
  if (subjectAltNames.length === 0) {
    throw new Error("At least one subject alternative name is required");
  }
  return {
    ...input,
    name: input.name.trim(),
    subjectAltNames
  };
}

function redactServerCertificate<T extends { privateKeyPem?: string | null }>(value: T | null | undefined) {
  if (!value) {
    return {};
  }
  return {
    ...value,
    privateKeyPem: "[redacted]"
  } as Record<string, unknown>;
}

function nullable(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
