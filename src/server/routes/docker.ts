import { Router } from "express";
import { z } from "zod";

import { sendValidationError } from "../lib/http.js";
import { getAuditContext } from "../lib/request-context.js";
import { DockerService } from "../services/docker-service.js";

const idSchema = z.object({
  id: z.coerce.number().int().positive()
});

const containerIdSchema = z.object({
  containerId: z.string().min(1)
});

const environmentSchema = z.object({
  name: z.string().min(2).max(120),
  connectionType: z.enum(["local_socket", "tcp", "tls"]),
  socketPath: z.string().max(255).nullable(),
  host: z.string().max(255).nullable(),
  port: z.number().int().min(1).max(65535).nullable(),
  tlsCaPem: z.string().min(1).nullable(),
  tlsCertPem: z.string().min(1).nullable(),
  tlsKeyPem: z.string().min(1).nullable(),
  publicIp: z.string().min(3).max(255),
  enabled: z.boolean()
});

const mappingSchema = z.object({
  environmentId: z.number().int().positive(),
  containerId: z.string().min(1),
  privatePort: z.number().int().positive(),
  publicPort: z.number().int().positive().nullable(),
  protocol: z.enum(["tcp", "udp"]),
  dnsName: z.string().min(2).max(255),
  routeName: z.string().min(2).max(120),
  routeProtocol: z.enum(["http", "https", "tcp", "udp"]),
  networkInterfaceId: z.number().int().positive().nullable(),
  listenAddress: z.string().min(2).max(255),
  listenPort: z.number().int().min(1).max(65535),
  sourcePath: z.string().max(255).nullable(),
  preserveHost: z.boolean(),
  enabled: z.boolean()
});

export function createDockerRouter(service: DockerService) {
  const router = Router();

  router.get("/dashboard", async (req, res) => {
    res.json(await service.getDashboard(getAuditContext(req)));
  });

  router.get("/environments", async (req, res) => {
    res.json(await service.listEnvironments(getAuditContext(req)));
  });

  router.post("/environments", async (req, res) => {
    try {
      const payload = environmentSchema.parse(req.body);
      res.status(201).json(await service.createEnvironment(payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.put("/environments/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      const payload = environmentSchema.parse(req.body);
      res.json(await service.updateEnvironment(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Docker environment not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.delete("/environments/:id", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      res.json(await service.deleteEnvironment(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Docker environment not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.get("/environments/:id/resource-stats", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      res.json(await service.getEnvironmentResourceStats(id));
    } catch (error) {
      if (error instanceof Error && error.message === "Docker environment not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(500).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.get("/environments/:id/containers", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      res.json(await service.listContainers(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Docker environment not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.get("/environments/:id/containers/:containerId", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      const { containerId } = containerIdSchema.parse(req.params);
      res.json(await service.getContainerDetail(id, containerId, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Docker environment not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.post("/environments/:id/containers/:containerId/automap", async (req, res) => {
    try {
      const { id } = idSchema.parse(req.params);
      const { containerId } = containerIdSchema.parse(req.params);
      res.status(201).json(await service.autoMapContainer(id, containerId, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Docker environment not found") {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  router.post("/mappings", async (req, res) => {
    try {
      const payload = mappingSchema.parse(req.body);
      res.status(201).json(await service.createPortMapping(payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  return router;
}
