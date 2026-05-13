import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../lib/async-handler.js";
import { requireScope } from "../lib/auth-middleware.js";
import { getAuditContext } from "../lib/request-context.js";
import { BootstrapNetworkInterfaceInput, NetworkInterfaceService } from "../services/network-interface-service.js";

const networkInterfaceSchema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().ip(),
  family: z.enum(["ipv4", "ipv6"]),
  enabled: z.boolean(),
  isDefault: z.boolean()
});

export function createNetworkInterfacesRouter(service: NetworkInterfaceService) {
  const router = Router();
  router.use(requireScope("admin"));

  router.get("/", asyncHandler(async (req, res) => {
    res.json(await service.list(getAuditContext(req)));
  }));

  router.post("/", asyncHandler(async (req, res) => {
    const payload = z.array(networkInterfaceSchema).min(1).parse(req.body) as BootstrapNetworkInterfaceInput[];
    res.status(201).json(await service.save(payload, getAuditContext(req)));
  }));

  return router;
}
