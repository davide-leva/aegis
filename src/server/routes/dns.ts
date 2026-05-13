import { Router } from "express";
import { z } from "zod";

import { AppError } from "../lib/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { requireReadWrite } from "../lib/auth-middleware.js";
import { getAuditContext } from "../lib/request-context.js";
import { BootstrapRootCaInput, DnsService } from "../services/dns-service.js";

const bootstrapSchema = z.object({
  organizationName: z.string().min(2),
  primaryContactEmail: z.string().email(),
  defaultZoneSuffix: z.string().min(2).regex(/^[a-zA-Z0-9.-]+$/),
  upstreamMode: z.enum(["redundant", "strict"]),
  dnsListenPort: z.number().int().min(1).max(65535),
  blocklistEnabled: z.boolean()
});

const bootstrapCaSchema = z.object({
  name: z.string().min(2).max(120),
  commonName: z.string().min(2).max(255),
  organization: z.string().max(255).nullable(),
  organizationalUnit: z.string().max(255).nullable(),
  country: z.string().length(2).nullable(),
  state: z.string().max(255).nullable(),
  locality: z.string().max(255).nullable(),
  emailAddress: z.string().email().nullable(),
  validityDays: z.number().int().min(30).max(3650),
  pathLength: z.number().int().min(0).max(10).nullable()
});

const zoneSchema = z.object({
  name: z.string().min(2).regex(/^[a-zA-Z0-9.-]+$/),
  kind: z.enum(["local", "forward"]),
  description: z.string().max(280).nullable(),
  cloudflareCredentialId: z.number().int().positive().nullable().default(null),
  isPrimary: z.boolean(),
  isReverse: z.boolean(),
  ttl: z.number().int().min(60).max(86400),
  enabled: z.boolean()
});

const recordSchema = z.object({
  zoneId: z.number().int().positive(),
  name: z.string().min(1).max(255),
  type: z.enum(["A", "AAAA", "CNAME", "TXT", "MX", "SRV"]),
  value: z.string().min(1).max(1024),
  ttl: z.number().int().min(60).max(86400),
  priority: z.number().int().min(0).max(65535).nullable(),
  proxiedService: z.string().max(120).nullable(),
  enabled: z.boolean()
});

const upstreamSchema = z.object({
  name: z.string().min(2).max(120),
  address: z.string().ip().or(z.string().min(3).max(253)),
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(["udp", "tcp", "https", "tls"]),
  enabled: z.boolean(),
  priority: z.number().int().min(1).max(999)
});

const blocklistSchema = z.object({
  pattern: z.string().min(2).max(1024),
  kind: z.enum(["domain", "suffix", "regex"]),
  source: z.string().max(255).nullable(),
  enabled: z.boolean()
});

const limitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const idSchema = z.object({
  id: z.coerce.number().int().positive()
});

export function createDnsRouter(service: DnsService) {
  const router = Router();
  router.use(requireReadWrite("dns:read", "dns:write"));

  router.get("/bootstrap", asyncHandler(async (req, res) => {
    res.json(await service.getBootstrap(getAuditContext(req)));
  }));

  router.post("/bootstrap", asyncHandler(async (req, res) => {
    const payload = bootstrapSchema.parse(req.body);
    try {
      res.status(201).json(await service.completeBootstrap(payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Bootstrap DNS settings already configured") throw AppError.conflict(error.message);
      throw error;
    }
  }));

  router.post("/bootstrap/settings", asyncHandler(async (req, res) => {
    const payload = bootstrapSchema.parse(req.body);
    try {
      res.status(201).json(await service.saveBootstrapSettings(payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Bootstrap DNS settings already configured") throw AppError.conflict(error.message);
      throw error;
    }
  }));

  router.post("/bootstrap/ca", asyncHandler(async (req, res) => {
    const payload = bootstrapCaSchema.parse(req.body) as BootstrapRootCaInput;
    res.status(201).json(await service.createBootstrapRootCertificateAuthority(payload, getAuditContext(req)));
  }));

  router.get("/dashboard", asyncHandler(async (req, res) => {
    res.json(await service.getDashboard(getAuditContext(req)));
  }));

  router.get("/zones", asyncHandler(async (req, res) => {
    res.json(await service.listZones(getAuditContext(req)));
  }));

  router.post("/zones", asyncHandler(async (req, res) => {
    const payload = zoneSchema.parse(req.body);
    res.status(201).json(await service.createZone(payload, getAuditContext(req)));
  }));

  router.put("/zones/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const payload = zoneSchema.parse(req.body);
    try {
      res.json(await service.updateZone(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Zone not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.delete("/zones/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    try {
      res.json(await service.deleteZone(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Zone not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.get("/records", asyncHandler(async (req, res) => {
    res.json(await service.listRecords(getAuditContext(req)));
  }));

  router.post("/records", asyncHandler(async (req, res) => {
    const payload = recordSchema.parse(req.body);
    res.status(201).json(await service.createRecord(payload, getAuditContext(req)));
  }));

  router.put("/records/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const payload = recordSchema.parse(req.body);
    try {
      res.json(await service.updateRecord(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Record not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.delete("/records/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    try {
      res.json(await service.deleteRecord(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Record not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.get("/upstreams", asyncHandler(async (req, res) => {
    res.json(await service.listUpstreams(getAuditContext(req)));
  }));

  router.post("/upstreams", asyncHandler(async (req, res) => {
    const payload = upstreamSchema.parse(req.body);
    res.status(201).json(await service.createUpstream(payload, getAuditContext(req)));
  }));

  router.put("/upstreams/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const payload = upstreamSchema.parse(req.body);
    try {
      res.json(await service.updateUpstream(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Upstream not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.delete("/upstreams/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    try {
      res.json(await service.deleteUpstream(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Upstream not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.get("/blocklist", asyncHandler(async (req, res) => {
    res.json(await service.listBlocklist(getAuditContext(req)));
  }));

  router.post("/blocklist", asyncHandler(async (req, res) => {
    const payload = blocklistSchema.parse(req.body);
    res.status(201).json(await service.createBlocklistEntry(payload, getAuditContext(req)));
  }));

  router.put("/blocklist/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const payload = blocklistSchema.parse(req.body);
    try {
      res.json(await service.updateBlocklistEntry(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Blocklist entry not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.delete("/blocklist/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    try {
      res.json(await service.deleteBlocklistEntry(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Blocklist entry not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.get("/audit", asyncHandler(async (req, res) => {
    const { limit } = limitSchema.parse(req.query);
    res.json(await service.listAuditLogs(getAuditContext(req), limit));
  }));

  router.get("/events", asyncHandler(async (req, res) => {
    const { limit } = limitSchema.parse(req.query);
    res.json(await service.listEvents(getAuditContext(req), limit));
  }));

  router.get("/runtime/status", asyncHandler(async (req, res) => {
    res.json(await service.getRuntimeStatus(getAuditContext(req)));
  }));

  router.get("/runtime/metrics", asyncHandler(async (req, res) => {
    res.json(await service.getRuntimeMetrics(getAuditContext(req)));
  }));

  router.get("/runtime/logs", asyncHandler(async (req, res) => {
    const { limit } = limitSchema.parse(req.query);
    res.json(await service.listRuntimeLogs(getAuditContext(req), limit));
  }));

  return router;
}
