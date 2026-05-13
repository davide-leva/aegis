import { X509Certificate } from "node:crypto";

import * as acme from "acme-client";

import type { EventBus } from "../events/event-bus.js";
import type { AcmeCertificateRepository } from "../repositories/acme-certificate-repository.js";
import type { Repositories } from "../repositories/index.js";
import type { AcmeAccount, AcmeCertificate, AuditContext, CloudflareCredential } from "../types.js";
import type { WsGateway } from "../ws/gateway.js";

const DNS_PROPAGATION_WAIT_MS = 15_000;

type OrderMaterial = {
  certificatePem: string;
  privateKeyPem: string;
  chainPem: string;
  serialNumber: string;
  issuedAt: string;
  expiresAt: string;
};

type ProgressFn = (step: string, status: "running" | "done" | "error", detail?: string) => void;

export type AcmeOrderMaterial = OrderMaterial;

export class AcmeService {
  constructor(
    private readonly repositories: Repositories,
    private readonly eventBus: EventBus,
    private readonly gateway?: WsGateway
  ) {}

  async listAccounts(_context: AuditContext) {
    return this.repositories.acmeAccounts.list();
  }

  async createAccount(
    input: { name: string; email: string; directoryUrl: string },
    context: AuditContext
  ) {
    const accountKey = await acme.crypto.createPrivateKey();
    const client = new acme.Client({ directoryUrl: input.directoryUrl, accountKey });
    await client.createAccount({ termsOfServiceAgreed: true, contact: [`mailto:${input.email}`] });
    const accountUrl = client.getAccountUrl();

    const account = await this.repositories.acmeAccounts.create({
      name: input.name,
      email: input.email,
      directoryUrl: input.directoryUrl,
      accountKeyPem: accountKey.toString(),
      accountUrl
    });

    await this.repositories.audit.create({
      action: "acme.account.create",
      entityType: "acme_account",
      entityId: String(account.id),
      payload: { name: account.name, email: account.email, directoryUrl: account.directoryUrl },
      context
    });

    return account;
  }

  async deleteAccount(id: number, context: AuditContext) {
    const certs = await this.repositories.acmeCertificates.list();
    if (certs.some((c) => c.acmeAccountId === id)) {
      throw new Error("ACME account is in use by certificates");
    }
    await this.repositories.acmeAccounts.delete(id);
    await this.repositories.audit.create({
      action: "acme.account.delete",
      entityType: "acme_account",
      entityId: String(id),
      payload: {},
      context
    });
  }

  async listCertificates(_context: AuditContext) {
    return this.repositories.acmeCertificates.list();
  }

  async issueCertificate(
    input: {
      name: string;
      domains: string[];
      acmeAccountId: number;
      cloudflareCredentialId: number;
      renewalDays: number;
    },
    context: AuditContext,
    operationId?: string
  ): Promise<AcmeCertificate> {
    const [account, cred] = await Promise.all([
      this.repositories.acmeAccounts.getById(input.acmeAccountId),
      this.repositories.cloudflareCredentials.getById(input.cloudflareCredentialId)
    ]);
    if (!account) throw new Error("ACME account not found");
    if (!cred) throw new Error("Cloudflare credential not found");

    const domains = [...new Set(input.domains.map((d) => d.toLowerCase().trim()))];
    const opId = operationId ?? `acme-issue-${Date.now()}`;
    const progress = this.makeProgress(opId);
    const material = await this.runOrder(account, cred, domains, progress);

    const cert = await this.repositories.acmeCertificates.create({
      name: input.name,
      acmeAccountId: input.acmeAccountId,
      cloudflareCredentialId: input.cloudflareCredentialId,
      domains,
      ...material,
      renewalDays: input.renewalDays,
      active: true
    });

    await this.repositories.audit.create({
      action: "acme.certificate.issue",
      entityType: "acme_certificate",
      entityId: String(cert.id),
      payload: { name: cert.name, domains: cert.domains, expiresAt: cert.expiresAt },
      context
    });

    await this.eventBus.publish({
      topic: "acme.certificate.issued",
      aggregateType: "acme_certificate",
      aggregateId: String(cert.id),
      payload: { name: cert.name, domains: cert.domains, expiresAt: cert.expiresAt },
      context
    });

    return cert;
  }

  async renewCertificate(id: number, context: AuditContext, operationId?: string): Promise<AcmeCertificate | undefined> {
    const cert = await this.repositories.acmeCertificates.getById(id);
    if (!cert) return undefined;

    const [account, cred] = await Promise.all([
      this.repositories.acmeAccounts.getById(cert.acmeAccountId),
      this.repositories.cloudflareCredentials.getById(cert.cloudflareCredentialId)
    ]);
    if (!account) throw new Error("ACME account not found");
    if (!cred) throw new Error("Cloudflare credential not found");

    const opId = operationId ?? `acme-renew-${id}-${Date.now()}`;
    const progress = this.makeProgress(opId);
    const material = await this.runOrder(account, cred, cert.domains, progress);
    const renewed = await this.repositories.acmeCertificates.updateMaterial(id, material);

    await this.repositories.audit.create({
      action: "acme.certificate.renew",
      entityType: "acme_certificate",
      entityId: String(id),
      payload: { expiresAt: material.expiresAt },
      context
    });

    await this.eventBus.publish({
      topic: "acme.certificate.renewed",
      aggregateType: "acme_certificate",
      aggregateId: String(id),
      payload: { name: cert.name, domains: cert.domains, expiresAt: material.expiresAt },
      context
    });

    return renewed;
  }

  async deleteCertificate(id: number, context: AuditContext) {
    const deleted = await this.repositories.acmeCertificates.delete(id);
    if (deleted) {
      await this.repositories.audit.create({
        action: "acme.certificate.delete",
        entityType: "acme_certificate",
        entityId: String(id),
        payload: { name: deleted.name },
        context
      });
      await this.eventBus.publish({
        topic: "acme.certificate.deleted",
        aggregateType: "acme_certificate",
        aggregateId: String(id),
        payload: { name: deleted.name },
        context
      });
    }
    return deleted;
  }

  private makeProgress(operationId: string): ProgressFn {
    return (step, status, detail) => {
      this.gateway?.broadcastAcmeProgress(operationId, step, status, detail);
    };
  }

  private async runOrder(
    account: AcmeAccount,
    cred: CloudflareCredential,
    domains: string[],
    progress?: ProgressFn
  ): Promise<OrderMaterial> {
    return issueAcmeOrderMaterial(account, cred, domains, progress);
  }
}

export async function issueAcmeOrderMaterial(
  account: AcmeAccount,
  cred: CloudflareCredential,
  domains: string[],
  progress?: ProgressFn
): Promise<OrderMaterial> {
  if (!account.accountUrl) throw new Error("ACME account has no registered URL — delete and re-create the account");
  const client = new acme.Client({
    directoryUrl: account.directoryUrl,
    accountKey: account.accountKeyPem,
    accountUrl: account.accountUrl
  });

  progress?.("Generating key and CSR", "running");
  const [privateKey, csr] = await acme.crypto.createCsr({ altNames: domains });
  progress?.("Generating key and CSR", "done");

  progress?.("Creating ACME order", "running");
  const order = await client.createOrder({
    identifiers: domains.map((d) => ({ type: "dns", value: d }))
  });
  progress?.("Creating ACME order", "done");

  const authorizations = await client.getAuthorizations(order);
  const cleanups: Array<() => Promise<void>> = [];

  try {
    for (const auth of authorizations) {
      const domain = auth.identifier.value;
      const challenge = auth.challenges.find((c) => c.type === "dns-01");
      if (!challenge) throw new Error(`No DNS-01 challenge for ${domain}`);

      progress?.(`DNS-01 challenge: ${domain}`, "running", "Adding TXT record to Cloudflare");
      const keyAuth = await client.getChallengeKeyAuthorization(challenge);
      const txtName = `_acme-challenge.${domain}`;
      const recordRef = await cloudflarePutTxt(cred.apiToken, txtName, keyAuth);
      cleanups.push(() => cloudflareDeleteTxt(cred.apiToken, recordRef));

      progress?.(`DNS-01 challenge: ${domain}`, "running", `Waiting ${DNS_PROPAGATION_WAIT_MS / 1000}s for DNS propagation`);
      await wait(DNS_PROPAGATION_WAIT_MS);

      progress?.(`DNS-01 challenge: ${domain}`, "running", "Completing challenge");
      await client.completeChallenge(challenge);
      await client.waitForValidStatus(challenge);
      progress?.(`DNS-01 challenge: ${domain}`, "done");
    }

    progress?.("Finalizing order and fetching certificate", "running");
    await client.finalizeOrder(order, csr);
    const chain = await client.getCertificate(order);
    progress?.("Finalizing order and fetching certificate", "done");

    const certs = splitChain(chain);
    const leafPem = certs[0] ?? chain;
    const chainPem = certs.slice(1).join("\n") || chain;
    const { serialNumber, issuedAt, expiresAt } = parseCertDates(leafPem);

    return {
      certificatePem: leafPem,
      privateKeyPem: privateKey.toString(),
      chainPem,
      serialNumber,
      issuedAt,
      expiresAt
    };
  } finally {
    for (const cleanup of cleanups) {
      await cleanup().catch((err) => console.error("DNS cleanup failed:", err));
    }
  }
}

// ─── Cloudflare helpers ────────────────────────────────────────────────────

async function findZoneId(apiToken: string, domain: string): Promise<string | null> {
  const parts = domain.split(".");
  for (let i = 0; i < parts.length; i++) {
    const zoneName = parts.slice(i).join(".");
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(zoneName)}`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    const data = await resp.json() as { success: boolean; result: Array<{ id: string }> };
    if (data.success && data.result.length > 0) return data.result[0].id;
  }
  return null;
}

async function cloudflarePutTxt(apiToken: string, name: string, content: string): Promise<string> {
  const baseDomain = name.replace(/^_acme-challenge\./, "");
  const zoneId = await findZoneId(apiToken, baseDomain);
  if (!zoneId) throw new Error(`No Cloudflare zone found for ${name}`);

  const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "TXT", name, content, ttl: 60 })
  });
  const data = await resp.json() as { success: boolean; result: { id: string }; errors: unknown[] };
  if (!data.success) throw new Error(`Cloudflare TXT create failed: ${JSON.stringify(data.errors)}`);
  return `${zoneId}:${data.result.id}`;
}

async function cloudflareDeleteTxt(apiToken: string, recordRef: string): Promise<void> {
  const [zoneId, recordId] = recordRef.split(":");
  await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiToken}` }
  });
}

// ─── Cert parsing helpers ──────────────────────────────────────────────────

function splitChain(pem: string): string[] {
  const matches = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  return matches ?? [];
}

function parseCertDates(certPem: string): { serialNumber: string; issuedAt: string; expiresAt: string } {
  try {
    const x509 = new X509Certificate(certPem);
    return {
      serialNumber: x509.serialNumber,
      issuedAt: new Date(x509.validFrom).toISOString(),
      expiresAt: new Date(x509.validTo).toISOString()
    };
  } catch {
    const now = new Date();
    return {
      serialNumber: Math.random().toString(36).slice(2).toUpperCase(),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 90 * 86400_000).toISOString()
    };
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
