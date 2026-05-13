import { Router } from "express";
import { z } from "zod";

import { requireScope } from "../lib/auth-middleware.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/app-error.js";
import { generateApiKey } from "../repositories/api-key-repository.js";
import type { Repositories } from "../repositories/index.js";
import { API_SCOPES } from "../types.js";

const createSchema = z.object({
  name: z.string().min(2).max(120),
  scopes: z.array(z.enum(API_SCOPES as unknown as [string, ...string[]])).min(1),
  expiresAt: z.string().datetime().nullable().optional()
});

const idSchema = z.object({
  id: z.coerce.number().int().positive()
});

export function createApiKeyRouter(repositories: Repositories) {
  const router = Router();

  router.get("/", requireScope("admin"), asyncHandler(async (req, res) => {
    const auth = req.auth!;
    if (auth.type !== "jwt") {
      res.status(403).json({ error: "Only users can manage API keys" });
      return;
    }
    const keys = await repositories.apiKeys.list(auth.sub);
    res.json(keys);
  }));

  router.post("/", requireScope("admin"), asyncHandler(async (req, res) => {
    const auth = req.auth!;
    if (auth.type !== "jwt") {
      res.status(403).json({ error: "Only users can create API keys" });
      return;
    }
    const input = createSchema.parse(req.body);
    const { plaintext, hash } = generateApiKey();
    const key = await repositories.apiKeys.create({
      name: input.name,
      scopes: input.scopes as any,
      createdBy: auth.sub,
      expiresAt: input.expiresAt ?? null,
      keyHash: hash
    });
    // Return plaintext only on creation — never stored
    res.status(201).json({ ...key, key: plaintext });
  }));

  router.delete("/:id", requireScope("admin"), asyncHandler(async (req, res) => {
    const auth = req.auth!;
    if (auth.type !== "jwt") {
      res.status(403).json({ error: "Only users can delete API keys" });
      return;
    }
    const { id } = idSchema.parse(req.params);
    const keys = await repositories.apiKeys.list(auth.sub);
    if (!keys.some((k) => k.id === id)) throw AppError.notFound("API key not found");
    await repositories.apiKeys.delete(id);
    res.status(204).end();
  }));

  return router;
}
