import { Router } from "express";
import { z } from "zod";

import { requireScope } from "../lib/auth-middleware.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/app-error.js";
import { getAuditContext } from "../lib/request-context.js";
import type { Repositories } from "../repositories/index.js";

const credentialSchema = z.object({
  name: z.string().min(2).max(120),
  apiToken: z.string().min(1).max(500)
});

const idSchema = z.object({
  id: z.coerce.number().int().positive()
});

const importZonesSchema = z.object({
  zoneNames: z.array(z.string().min(1)).min(1)
});

export function createCloudflareRouter(repositories: Repositories) {
  const router = Router();

  router.get("/credentials", requireScope("ca:read"), asyncHandler(async (_req, res) => {
    const creds = await repositories.cloudflareCredentials.list();
    // Never expose the raw token in list responses
    res.json(creds.map(({ apiToken: _t, ...rest }) => rest));
  }));

  router.post("/credentials", requireScope("ca:write"), asyncHandler(async (req, res) => {
    const context = getAuditContext(req);
    const input = credentialSchema.parse(req.body);
    const cred = await repositories.cloudflareCredentials.create(input);
    await repositories.audit.create({
      action: "cloudflare.credential.create",
      entityType: "cloudflare_credential",
      entityId: String(cred.id),
      payload: { name: cred.name },
      context
    });
    const { apiToken: _t, ...safe } = cred;
    res.status(201).json(safe);
  }));

  router.put("/credentials/:id", requireScope("ca:write"), asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const context = getAuditContext(req);
    const input = credentialSchema.parse(req.body);
    const existing = await repositories.cloudflareCredentials.getById(id);
    if (!existing) throw AppError.notFound("Cloudflare credential not found");
    const updated = await repositories.cloudflareCredentials.update(id, input);
    await repositories.audit.create({
      action: "cloudflare.credential.update",
      entityType: "cloudflare_credential",
      entityId: String(id),
      payload: { name: updated?.name },
      context
    });
    const { apiToken: _t, ...safe } = updated!;
    res.json(safe);
  }));

  router.get("/credentials/:id/zones", requireScope("ca:read"), asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const cred = await repositories.cloudflareCredentials.getById(id);
    if (!cred) throw AppError.notFound("Cloudflare credential not found");

    const cfRes = await fetch("https://api.cloudflare.com/client/v4/zones?per_page=100&status=active", {
      headers: { Authorization: `Bearer ${cred.apiToken}`, "Content-Type": "application/json" }
    });

    if (!cfRes.ok) {
      throw new AppError("Failed to fetch zones from Cloudflare — check that the token has Zone:Read permission", 400);
    }

    const cfData = await cfRes.json() as { result: Array<{ id: string; name: string; status: string }> };
    const existingZones = await repositories.zones.list();
    const existingByName = new Map(existingZones.map((z) => [z.name, z]));

    res.json(cfData.result.map((z) => {
      const existing = existingByName.get(z.name);
      return {
        id: z.id,
        name: z.name,
        status: z.status,
        alreadyImported: existing?.kind === "local",
        needsUpgrade: existing?.kind === "forward"
      };
    }));
  }));

  router.post("/credentials/:id/zones/import", requireScope("ca:write"), asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const context = getAuditContext(req);
    const { zoneNames } = importZonesSchema.parse(req.body);

    const cred = await repositories.cloudflareCredentials.getById(id);
    if (!cred) throw AppError.notFound("Cloudflare credential not found");

    const existingZones = await repositories.zones.list();
    const existingByName = new Map(existingZones.map((z) => [z.name, z]));

    const created = [];
    const upgraded = [];
    for (const name of zoneNames) {
      const existing = existingByName.get(name);
      if (existing?.kind === "local") continue;

      const zoneInput = {
        name,
        kind: "local" as const,
        description: `Imported from Cloudflare (${cred.name})`,
        isPrimary: false,
        isReverse: false,
        ttl: 300,
        enabled: true
      };

      if (existing?.kind === "forward") {
        const updated = await repositories.zones.update(existing.id, zoneInput);
        upgraded.push(updated);
      } else {
        const zone = await repositories.zones.create(zoneInput);
        created.push(zone);
      }
    }

    await repositories.audit.create({
      action: "cloudflare.zones.import",
      entityType: "cloudflare_credential",
      entityId: String(id),
      payload: { credentialName: cred.name, created: created.length, upgraded: upgraded.length },
      context
    });

    res.status(201).json({ imported: created.length + upgraded.length, created: created.length, upgraded: upgraded.length });
  }));

  router.delete("/credentials/:id", requireScope("ca:write"), asyncHandler(async (req, res) => {
    const { id } = idSchema.parse(req.params);
    const context = getAuditContext(req);
    const existing = await repositories.cloudflareCredentials.getById(id);
    if (!existing) throw AppError.notFound("Cloudflare credential not found");
    const acmeCerts = await repositories.acmeCertificates.list();
    if (acmeCerts.some((c) => c.cloudflareCredentialId === id)) {
      throw AppError.conflict("Credential is in use by ACME certificates");
    }
    await repositories.cloudflareCredentials.delete(id);
    await repositories.audit.create({
      action: "cloudflare.credential.delete",
      entityType: "cloudflare_credential",
      entityId: String(id),
      payload: { name: existing.name },
      context
    });
    res.status(204).end();
  }));

  return router;
}
