import { Router } from "express";
import { z } from "zod";

import { AppError } from "../lib/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { requireReadWrite } from "../lib/auth-middleware.js";
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
  router.use(requireReadWrite("docker:read", "docker:write"));

  router.get("/dashboard", asyncHandler(async (req, res) => {
    res.json(await service.getDashboard(getAuditContext(req)));
  }));

  router.get("/environments", asyncHandler(async (req, res) => {
    res.json(await service.listEnvironments(getAuditContext(req)));
  }));

  router.post("/environments", asyncHandler(async (req, res) => {
    const payload = environmentSchema.parse(req.body);
    res.status(201).json(await service.createEnvironment(payload, getAuditContext(req)));
  }));

  router.put("/environments/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const payload = environmentSchema.parse(req.body);
    try {
      res.json(await service.updateEnvironment(id, payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Docker environment not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.delete("/environments/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    try {
      res.json(await service.deleteEnvironment(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Docker environment not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.get("/environments/:id/resource-stats", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    try {
      res.json(await service.getEnvironmentResourceStats(id));
    } catch (error) {
      if (error instanceof Error && error.message === "Docker environment not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.get("/environments/:id/containers", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    try {
      res.json(await service.listContainers(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Docker environment not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.get("/environments/:id/containers/:containerId", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const { containerId } = containerIdSchema.parse(req.params);
    try {
      res.json(await service.getContainerDetail(id, containerId, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Docker environment not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.post("/environments/:id/containers/:containerId/automap", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const { containerId } = containerIdSchema.parse(req.params);
    try {
      res.status(201).json(await service.autoMapContainer(id, containerId, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Docker environment not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  router.post("/mappings", asyncHandler(async (req, res) => {
    const payload = mappingSchema.parse(req.body);
    res.status(201).json(await service.createPortMapping(payload, getAuditContext(req)));
  }));

  router.delete("/mappings/:id", asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    try {
      res.json(await service.deletePortMapping(id, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error && error.message === "Mapping not found") throw AppError.notFound(error.message);
      throw error;
    }
  }));

  return router;
}
