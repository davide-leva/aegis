import { Router } from "express";
import { z } from "zod";

import { sendValidationError } from "../lib/http.js";
import { getAuditContext } from "../lib/request-context.js";
import { BootstrapNetworkInterfaceInput, NetworkInterfaceService } from "../services/network-interface-service.js";

const networkInterfaceSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  family: z.enum(["ipv4", "ipv6"]),
  enabled: z.boolean(),
  isDefault: z.boolean()
});

export function createNetworkInterfacesRouter(service: NetworkInterfaceService) {
  const router = Router();

  router.get("/", async (req, res) => {
    res.json(await service.list(getAuditContext(req)));
  });

  router.post("/", async (req, res) => {
    try {
      const payload = z.array(networkInterfaceSchema).min(1).parse(req.body) as BootstrapNetworkInterfaceInput[];
      res.status(201).json(await service.save(payload, getAuditContext(req)));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ error: error.message });
      }
      return sendValidationError(res, error);
    }
  });

  return router;
}
