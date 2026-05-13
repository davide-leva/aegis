import { Router } from "express";
import { z } from "zod";

import { requireScope } from "../lib/auth-middleware.js";
import { asyncHandler } from "../lib/async-handler.js";
import type { Repositories } from "../repositories/index.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  topic: z.string().optional()
});

export function createEventsRouter(repositories: Repositories) {
  const router = Router();

  router.get("/", requireScope("ca:read"), asyncHandler(async (req, res) => {
    const { limit, offset, topic } = querySchema.parse(req.query);
    const [items, total] = await Promise.all([
      repositories.events.list({ limit, offset, topicPrefix: topic }),
      repositories.events.count(topic)
    ]);
    res.json({ items, total });
  }));

  return router;
}
