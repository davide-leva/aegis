import { Router } from "express";
import { z } from "zod";

import { requireScope } from "../lib/auth-middleware.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/app-error.js";
import type { Repositories } from "../repositories/index.js";

const GROUP_ALLOWLIST = new Set(["app", "cloudflare", "dns", "proxy"]);

const groupIdSchema = z.object({
  groupId: z.string().min(1).max(64).refine((g) => GROUP_ALLOWLIST.has(g), {
    message: "Unknown config group"
  })
});

export function createConfigRouter(repositories: Repositories) {
  const router = Router();

  router.get("/:groupId", requireScope("admin"), asyncHandler(async (req, res) => {
    const { groupId } = groupIdSchema.parse(req.params);
    const data = await repositories.config.getGroup(groupId);
    res.json(data);
  }));

  router.put("/:groupId", requireScope("admin"), asyncHandler(async (req, res) => {
    const { groupId } = groupIdSchema.parse(req.params);
    const body = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw AppError.notFound("Body must be a flat key-value object");
    }
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v !== "string") throw new AppError(`Value for key "${k}" must be a string`, 400);
      values[k] = v;
    }
    await repositories.config.setGroup(groupId, values);
    const updated = await repositories.config.getGroup(groupId);
    res.json(updated);
  }));

  return router;
}
