import { Router } from "express";
import { z } from "zod";

import { sendValidationError } from "../lib/http.js";
import { getAuditContext } from "../lib/request-context.js";
import { ProxyService } from "../services/proxy-service.js";

const routeSchema = z.object({
  name: z.string().min(2).max(120),
  protocol: z.enum(["http", "https", "tcp", "udp"]),
  networkInterfaceId: z.number().int().positive().nullable(),
  listenAddress: z.string().min(2).max(255),
  listenPort: z.number().int().min(1).max(65535),
  sourceHost: z.string().max(255).nullable(),
  sourcePath: z.string().max(255).nullable(),
  targetHost: z.string().min(2).max(255),
  targetPort: z.number().int().min(1).max(65535),
  targetProtocol: z.enum(["http", "https", "tcp", "udp"]),
  preserveHost: z.boolean(),
  tlsCertPem: z.string().min(1).nullable(),
  tlsKeyPem: z.string().min(1).nullable(),
  enabled: z.boolean()
});

const limitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const idSchema = z.object({
  id: z.coerce.number().int().positive()
});

export function createProxyRouter(service: ProxyService) {
  const router = Router();

  router.get("/dashboard", async (req, res) => {
    res.json(await service.getDashboard(getAuditContext(req)));
  });

  router.get("/routes", async (req, res) => {
    res.json(await service.listRoutes(getAuditContext(req)));
  });

  router.post("/routes", async (req, res) => {
    try {
      const payload = routeSchema.parse(req.body);
      res.status(201).json(await service.createRoute(payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.put("/routes/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      const payload = routeSchema.parse(req.body);
      res.json(await service.updateRoute(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Proxy route not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.delete("/routes/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      res.json(await service.deleteRoute(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Proxy route not found") {
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
