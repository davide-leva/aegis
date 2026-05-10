import { Router } from "express";
import { z } from "zod";

import { sendValidationError } from "../lib/http.js";
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

  router.get("/dashboard", async (req, res) => {
    res.json(await service.getDashboard(getAuditContext(req)));
  });

  router.get("/subjects", async (req, res) => {
    res.json(await service.listSubjects(getAuditContext(req)));
  });

  router.post("/subjects", async (req, res) => {
    try {
      const payload = subjectSchema.parse(req.body);
      res.status(201).json(await service.createSubject(payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.put("/subjects/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      const payload = subjectSchema.parse(req.body);
      res.json(await service.updateSubject(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Certificate subject not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.delete("/subjects/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      res.json(await service.deleteSubject(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Certificate subject not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.get("/cas", async (req, res) => {
    res.json(await service.listCertificateAuthorities(getAuditContext(req)));
  });

  router.post("/cas", async (req, res) => {
    try {
      const payload = certificateAuthoritySchema.parse(req.body);
      res.status(201).json(await service.createCertificateAuthority(payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.get("/server-certificates", async (req, res) => {
    res.json(await service.listServerCertificates(getAuditContext(req)));
  });

  router.post("/server-certificates", async (req, res) => {
    try {
      const payload = serverCertificateSchema.parse(req.body);
      res.status(201).json(await service.createServerCertificate(payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.post("/server-certificates/:id/renew", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      res.json(await service.renewServerCertificate(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Server certificate not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.get("/cas/:id/download/:kind", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      const { kind } = caDownloadKindSchema.parse(req.params);
      const result = await service.downloadCertificateAuthority(id, kind, getAuditContext(req));
      res.setHeader("Content-Type", "application/x-pem-file");
      res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
      res.send(result.contents);
    } catch (error) {
      if (error instanceof Error && error.message === "Certificate authority not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.get("/server-certificates/:id/download/:kind", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      const { kind } = serverDownloadKindSchema.parse(req.params);
      const result = await service.downloadServerCertificate(id, kind, getAuditContext(req));
      res.setHeader("Content-Type", "application/x-pem-file");
      res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
      res.send(result.contents);
    } catch (error) {
      if (error instanceof Error && error.message === "Server certificate not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  return router;
}
