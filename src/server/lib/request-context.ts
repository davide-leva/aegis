import type { Request } from "express";

import type { AuditContext } from "../types.js";

export function getAuditContext(req: Request): AuditContext {
  const forwarded = req.headers["x-forwarded-for"];
  const sourceIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim() ?? null
      : req.ip ?? null;

  const auth = req.auth;

  if (auth?.type === "jwt") {
    return {
      actorType: "user",
      actorId: auth.username,
      sourceIp,
      userAgent: req.header("user-agent") ?? null
    };
  }

  if (auth?.type === "api_key") {
    return {
      actorType: "api_client",
      actorId: auth.name,
      sourceIp,
      userAgent: req.header("user-agent") ?? null
    };
  }

  return {
    actorType: "system",
    actorId: "anonymous",
    sourceIp,
    userAgent: req.header("user-agent") ?? null
  };
}
