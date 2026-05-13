import { Router } from "express";
import { z } from "zod";

import { requireScope } from "../lib/auth-middleware.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/app-error.js";
import { getAuditContext } from "../lib/request-context.js";
import type { AcmeService } from "../services/acme-service.js";

const idSchema = z.object({
  id: z.coerce.number().int().positive()
});

const createAccountSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  directoryUrl: z.string().url()
});

const issueCertSchema = z.object({
  name: z.string().min(2).max(120),
  domains: z.array(z.string().min(3)).min(1).max(50),
  acmeAccountId: z.number().int().positive(),
  cloudflareCredentialId: z.number().int().positive(),
  renewalDays: z.number().int().min(1).max(60).default(30)
});

export function createAcmeRouter(acmeService: AcmeService) {
  const router = Router();

  // ─── Accounts ────────────────────────────────────────────────────────────

  router.get("/accounts", requireScope("ca:read"), asyncHandler(async (req, res) => {
    const context = getAuditContext(req);
    const accounts = await acmeService.listAccounts(context);
    // Never expose the account private key in list responses
    res.json(accounts.map(({ accountKeyPem: _k, ...rest }) => rest));
  }));

  router.post("/accounts", requireScope("ca:write"), asyncHandler(async (req, res) => {
    const context = getAuditContext(req);
    const input = createAccountSchema.parse(req.body);
    const account = await acmeService.createAccount(input, context);
    const { accountKeyPem: _k, ...safe } = account;
    res.status(201).json(safe);
  }));

  router.delete("/accounts/:id", requireScope("ca:write"), asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const context = getAuditContext(req);
    try {
      await acmeService.deleteAccount(id, context);
    } catch (err) {
      if (err instanceof Error && err.message.includes("in use")) throw AppError.conflict(err.message);
      throw err;
    }
    res.status(204).end();
  }));

  // ─── Certificates ─────────────────────────────────────────────────────────

  router.get("/certificates", requireScope("ca:read"), asyncHandler(async (req, res) => {
    const context = getAuditContext(req);
    const certs = await acmeService.listCertificates(context);
    res.json(certs.map(({ privateKeyPem: _k, ...rest }) => rest));
  }));

  router.post("/certificates", requireScope("ca:write"), asyncHandler(async (req, res) => {
    const context = getAuditContext(req);
    const input = issueCertSchema.parse(req.body);
    const operationId = `acme-issue-${Date.now()}`;
    res.setHeader("X-Operation-Id", operationId);
    try {
      const cert = await acmeService.issueCertificate(input, context, operationId);
      const { privateKeyPem: _k, ...safe } = cert;
      res.status(201).json(safe);
    } catch (err) {
      if (err instanceof AppError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ACME] Certificate issuance failed:", err);
      if (msg.includes("not found")) throw AppError.notFound(msg);
      throw AppError.unprocessable(msg);
    }
  }));

  router.post("/certificates/:id/renew", requireScope("ca:write"), asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const context = getAuditContext(req);
    const operationId = `acme-renew-${id}-${Date.now()}`;
    res.setHeader("X-Operation-Id", operationId);
    try {
      const cert = await acmeService.renewCertificate(id, context, operationId);
      if (!cert) throw AppError.notFound("ACME certificate not found");
      const { privateKeyPem: _k, ...safe } = cert;
      res.json(safe);
    } catch (err) {
      if (err instanceof AppError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ACME] Certificate renewal failed:", err);
      throw AppError.unprocessable(msg);
    }
  }));

  router.get("/certificates/:id/material", requireScope("ca:read"), asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const context = getAuditContext(req);
    const certs = await acmeService.listCertificates(context);
    const cert = certs.find((c) => c.id === id);
    if (!cert) throw AppError.notFound("ACME certificate not found");
    res.json({ certificatePem: cert.certificatePem, privateKeyPem: cert.privateKeyPem });
  }));

  router.get("/certificates/:id/download", requireScope("ca:read"), asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const { kind } = z.object({ kind: z.enum(["certificate", "key", "chain"]) }).parse(req.query);
    const context = getAuditContext(req);
    const certs = await acmeService.listCertificates(context);
    const cert = certs.find((c) => c.id === id);
    if (!cert) throw AppError.notFound("ACME certificate not found");
    const contents =
      kind === "certificate" ? cert.certificatePem
      : kind === "key" ? cert.privateKeyPem
      : cert.chainPem;
    const ext = kind === "certificate" ? "crt.pem" : kind === "key" ? "key.pem" : "chain.pem";
    res.setHeader("Content-Type", "application/x-pem-file");
    res.setHeader("Content-Disposition", `attachment; filename="${cert.name}.${ext}"`);
    res.send(contents);
  }));

  router.delete("/certificates/:id", requireScope("ca:write"), asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const context = getAuditContext(req);
    const deleted = await acmeService.deleteCertificate(id, context);
    if (!deleted) throw AppError.notFound("ACME certificate not found");
    res.status(204).end();
  }));

  return router;
}
