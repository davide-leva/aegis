import { Router } from "express";
import { z } from "zod";

import { sendValidationError } from "../lib/http.js";
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
  isPrimary: z.boolean(),
  isReverse: z.boolean(),
  ttl: z.number().int().min(60).max(86400),
  enabled: z.boolean()
});

const recordSchema = z.object({
  zoneId: z.number().int().positive(),
  name: z.string().min(1),
  type: z.enum(["A", "AAAA", "CNAME", "TXT", "MX", "SRV"]),
  value: z.string().min(1),
  ttl: z.number().int().min(60).max(86400),
  priority: z.number().int().min(0).max(65535).nullable(),
  proxiedService: z.string().max(120).nullable(),
  enabled: z.boolean()
});

const upstreamSchema = z.object({
  name: z.string().min(2),
  address: z.string().min(3),
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(["udp", "tcp", "https", "tls"]),
  enabled: z.boolean(),
  priority: z.number().int().min(1).max(999)
});

const blocklistSchema = z.object({
  pattern: z.string().min(2),
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

  router.get("/bootstrap", async (req, res) => {
    res.json(await service.getBootstrap(getAuditContext(req)));
  });

  router.post("/bootstrap", async (req, res) => {
    try {
      const payload = bootstrapSchema.parse(req.body);
      const result = await service.completeBootstrap(payload, getAuditContext(req));
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Bootstrap DNS settings already configured") {
        return res.status(409).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.post("/bootstrap/settings", async (req, res) => {
    try {
      const payload = bootstrapSchema.parse(req.body);
      const result = await service.saveBootstrapSettings(payload, getAuditContext(req));
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Bootstrap DNS settings already configured") {
        return res.status(409).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.post("/bootstrap/ca", async (req, res) => {
    try {
      const payload = bootstrapCaSchema.parse(req.body) as BootstrapRootCaInput;
      res.status(201).json(await service.createBootstrapRootCertificateAuthority(payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.get("/dashboard", async (req, res) => {
    res.json(await service.getDashboard(getAuditContext(req)));
  });

  router.get("/zones", async (req, res) => {
    res.json(await service.listZones(getAuditContext(req)));
  });

  router.post("/zones", async (req, res) => {
    try {
      const payload = zoneSchema.parse(req.body);
      res.status(201).json(await service.createZone(payload, getAuditContext(req)));
    } catch (error) {
      return sendValidationError(res, error);
    }
  });

  router.put("/zones/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      const payload = zoneSchema.parse(req.body);
      res.json(await service.updateZone(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Zone not found") {
        return res.status(404).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.delete("/zones/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      res.json(await service.deleteZone(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Zone not found") {
        return res.status(404).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.get("/records", async (req, res) => {
    res.json(await service.listRecords(getAuditContext(req)));
  });

  router.post("/records", async (req, res) => {
    try {
      const payload = recordSchema.parse(req.body);
      res.status(201).json(await service.createRecord(payload, getAuditContext(req)));
    } catch (error) {
      return sendValidationError(res, error);
    }
  });

  router.put("/records/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      const payload = recordSchema.parse(req.body);
      res.json(await service.updateRecord(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Record not found") {
        return res.status(404).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.delete("/records/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      res.json(await service.deleteRecord(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Record not found") {
        return res.status(404).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.get("/upstreams", async (req, res) => {
    res.json(await service.listUpstreams(getAuditContext(req)));
  });

  router.post("/upstreams", async (req, res) => {
    try {
      const payload = upstreamSchema.parse(req.body);
      res.status(201).json(await service.createUpstream(payload, getAuditContext(req)));
    } catch (error) {
      return sendValidationError(res, error);
    }
  });

  router.put("/upstreams/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      const payload = upstreamSchema.parse(req.body);
      res.json(await service.updateUpstream(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Upstream not found") {
        return res.status(404).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.delete("/upstreams/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      res.json(await service.deleteUpstream(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Upstream not found") {
        return res.status(404).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.get("/blocklist", async (req, res) => {
    res.json(await service.listBlocklist(getAuditContext(req)));
  });

  router.post("/blocklist", async (req, res) => {
    try {
      const payload = blocklistSchema.parse(req.body);
      res.status(201).json(await service.createBlocklistEntry(payload, getAuditContext(req)));
    } catch (error) {
      return sendValidationError(res, error);
    }
  });

  router.put("/blocklist/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      const payload = blocklistSchema.parse(req.body);
      res.json(await service.updateBlocklistEntry(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Blocklist entry not found") {
        return res.status(404).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.delete("/blocklist/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      res.json(await service.deleteBlocklistEntry(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Blocklist entry not found") {
        return res.status(404).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.get("/audit", async (req, res) => {
    const { limit } = limitSchema.parse(req.query);
    res.json(await service.listAuditLogs(getAuditContext(req), limit));
  });

  router.get("/events", async (req, res) => {
    const { limit } = limitSchema.parse(req.query);
    res.json(await service.listEvents(getAuditContext(req), limit));
  });

  router.get("/runtime/status", async (req, res) => {
    res.json(await service.getRuntimeStatus(getAuditContext(req)));
  });

  router.get("/runtime/metrics", async (req, res) => {
    res.json(await service.getRuntimeMetrics(getAuditContext(req)));
  });

  router.get("/runtime/logs", async (req, res) => {
    const { limit } = limitSchema.parse(req.query);
    res.json(await service.listRuntimeLogs(getAuditContext(req), limit));
  });

  return router;
}
