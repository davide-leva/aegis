import { Router } from "express";
import { z } from "zod";

import { AppError } from "../lib/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { requireReadWrite } from "../lib/auth-middleware.js";
import { getAuditContext } from "../lib/request-context.js";
import { CertificateService } from "../services/certificate-service.js";

const idSchema = z.object({
  id: z.coerce.number().int().positive()
});

const subjectSchema = z.object({
  name: z.string().min(2).max(120),
  parentSubjectId: z.number().int().positive().nullable(),
  commonName: z.string().min(2).max(255).nullable(),
  organization: z.string().max(255).nullable(),
  organizationalUnit: z.string().max(255).nullable(),
  country: z.string().length(2).nullable(),
  state: z.string().max(255).nullable(),
  locality: z.string().max(255).nullable(),
  emailAddress: z.string().email().nullable()
}).superRefine((value, ctx) => {
  if (value.parentSubjectId == null && !value.commonName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["commonName"],
      message: "Common name is required for root subjects"
    });
  }
});

const certificateAuthoritySchema = z.object({
  name: z.string().min(2).max(120),
  subjectId: z.number().int().positive(),
  issuerCaId: z.number().int().positive().nullable(),
  validityDays: z.number().int().min(30).max(3650),
  pathLength: z.number().int().min(0).max(10).nullable(),
  isDefault: z.boolean(),
  active: z.boolean()
});

const serverCertificateSchema = z.object({
  name: z.string().min(2).max(120),
  subjectId: z.number().int().positive(),
  caId: z.number().int().positive(),
  subjectAltNames: z.array(z.string().min(1)).min(1).max(50),
  validityDays: z.number().int().min(1).max(825),
  renewalDays: z.number().int().min(1).max(365),
  active: z.boolean()
});

const caDownloadKindSchema = z.object({
  kind: z.enum(["certificate", "key"])
});

const serverDownloadKindSchema = z.object({
  kind: z.enum(["certificate", "key", "chain"])
});

export function createCertificateRouter(service: CertificateService) {
  const router = Router();
  router.use(requireReadWrite("ca:read", "ca:write"));

  router.get("/dashboard", asyncHandler(async (req, res) => {
    res.json(await service.getDashboard(getAuditContext(req)));
  }));

  router.get("/subjects", asyncHandler(async (req, res) => {
    res.json(await service.listSubjects(getAuditContext(req)));
  }));

  router.post("/subjects", asyncHandler(async (req, res) => {
    const payload = subjectSchema.parse(req.body);
    res.status(201).json(await service.createSubject(payload, getAuditContext(req)));
  }));

  router.put("/subjects/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const payload = subjectSchema.parse(req.body);
    try {
      res.json(await service.updateSubject(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Certificate subject not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.delete("/subjects/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    try {
      res.json(await service.deleteSubject(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Certificate subject not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.get("/cas", asyncHandler(async (req, res) => {
    res.json(await service.listCertificateAuthorities(getAuditContext(req)));
  }));

  router.post("/cas", asyncHandler(async (req, res) => {
    const payload = certificateAuthoritySchema.parse(req.body);
    res.status(201).json(await service.createCertificateAuthority(payload, getAuditContext(req)));
  }));

  router.get("/server-certificates", asyncHandler(async (req, res) => {
    res.json(await service.listServerCertificates(getAuditContext(req)));
  }));

  router.post("/server-certificates", asyncHandler(async (req, res) => {
    const payload = serverCertificateSchema.parse(req.body);
    res.status(201).json(await service.createServerCertificate(payload, getAuditContext(req)));
  }));

  router.post("/server-certificates/:id/renew", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    try {
      res.json(await service.renewServerCertificate(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Server certificate not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.get("/cas/:id/download/:kind", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const { kind } = caDownloadKindSchema.parse(req.params);
    try {
      const result = await service.downloadCertificateAuthority(id, kind, getAuditContext(req));
      res.setHeader("Content-Type", "application/x-pem-file");
      res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
      res.send(result.contents);
    } catch (error) {
      if (error instanceof Error && error.message === "Certificate authority not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.get("/server-certificates/:id/download/:kind", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const { kind } = serverDownloadKindSchema.parse(req.params);
    try {
      const result = await service.downloadServerCertificate(id, kind, getAuditContext(req));
      res.setHeader("Content-Type", "application/x-pem-file");
      res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
      res.send(result.contents);
    } catch (error) {
      if (error instanceof Error && error.message === "Server certificate not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  return router;
}
