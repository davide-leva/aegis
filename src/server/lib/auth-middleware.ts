import type { NextFunction, Request, Response } from "express";

import { hashApiKey } from "../repositories/api-key-repository.js";
import type { Repositories } from "../repositories/index.js";
import type { ApiScope } from "../types.js";
import { verifyToken } from "./jwt.js";

export type AuthInfo =
  | { type: "jwt"; sub: number; username: string }
  | { type: "api_key"; keyId: number; name: string; scopes: ApiScope[] };

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthInfo;
  }
}

export function createAuthMiddleware(repositories: Repositories) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers["authorization"];
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const token = header.slice(7);

    // Try JWT first
    try {
      const payload = verifyToken(token);
      req.auth = { type: "jwt", sub: payload.sub, username: payload.username };
      return next();
    } catch {
      // not a JWT — fall through
    }

    // Try API key
    if (token.startsWith("aegis_")) {
      const hash = hashApiKey(token);
      const key = await repositories.apiKeys.findByHash(hash).catch(() => undefined);
      if (key) {
        if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
          res.status(401).json({ error: "API key expired" });
          return;
        }
        req.auth = { type: "api_key", keyId: key.id, name: key.name, scopes: key.scopes };
        repositories.apiKeys.updateLastUsed(key.id).catch(console.error);
        return next();
      }
    }

    res.status(401).json({ error: "Unauthorized" });
  };
}

export function requireScope(...required: ApiScope[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    // JWT has all scopes
    if (auth.type === "jwt") return next();

    const scopes = auth.scopes;
    if (scopes.includes("admin")) return next();
    const ok = required.some((need) => {
      if (scopes.includes(need)) return true;
      // write scope implies read
      if (need.endsWith(":read")) {
        return scopes.includes(need.replace(":read", ":write") as ApiScope);
      }
      return false;
    });
    if (ok) return next();
    res.status(403).json({ error: "Insufficient scope" });
  };
}

// Legacy export — still used in auth route for /me endpoint
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers["authorization"];
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    req.auth = { type: "jwt", sub: payload.sub, username: payload.username };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

/**
 * Applies readScope for all requests and writeScope for mutating methods.
 * Eliminates the repeated inline guard in every route module.
 */
export function requireReadWrite(readScope: ApiScope, writeScope: ApiScope) {
  const checkRead = requireScope(readScope);
  const checkWrite = requireScope(writeScope);
  const WRITE_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);
  return (req: Request, res: Response, next: NextFunction) => {
    checkRead(req, res, (err?: unknown) => {
      if (err) return next(err);
      if (WRITE_METHODS.has(req.method)) return checkWrite(req, res, next);
      next();
    });
  };
}
