import type { Request } from "express";

import type { AuditContext } from "../types.js";

export function getAuditContext(req: Request): AuditContext {
  const forwarded = req.headers["x-forwarded-for"];
  const sourceIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim() ?? null
      : req.ip ?? null;

  return {
    actorType: req.header("x-aegis-actor-id") ? "api_client" : "system",
    actorId: req.header("x-aegis-actor-id") ?? "anonymous",
    sourceIp,
    userAgent: req.header("user-agent") ?? null
  };
}
