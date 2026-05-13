import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { requireAuth } from "../lib/auth-middleware.js";
import { signToken, verifyToken } from "../lib/jwt.js";
import type { Repositories } from "../repositories/index.js";

const setupSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/, "Only letters, numbers, _ and - allowed"),
  password: z.string().min(8).max(256)
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export function createAuthRouter(repositories: Repositories) {
  const router = Router();

  // Returns whether first-time setup is needed and whether the caller is authenticated.
  // Always public — the frontend uses this to decide which page to show.
  router.get("/status", async (req, res) => {
    try {
      const userCount = await repositories.users.count();
      const setupRequired = userCount === 0;

      const authHeader = req.headers["authorization"];
      let authenticated = false;
      if (authHeader?.startsWith("Bearer ")) {
        try {
          verifyToken(authHeader.slice(7));
          authenticated = true;
        } catch {
          authenticated = false;
        }
      }

      res.json({ setupRequired, authenticated });
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // First-run setup — creates the first admin user. Blocked once any user exists.
  router.post("/setup", async (req, res) => {
    try {
      const userCount = await repositories.users.count();
      if (userCount > 0) {
        res.status(409).json({ error: "Setup already completed" });
        return;
      }

      const parsed = setupSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
        return;
      }

      const { username, password } = parsed.data;
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await repositories.users.create({ username, passwordHash });

      const token = signToken({ sub: user.id, username: user.username });
      res.status(201).json({ token, user: { id: user.id, username: user.username } });
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Login
  router.post("/login", async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Username and password are required" });
        return;
      }

      const { username, password } = parsed.data;
      const user = await repositories.users.findByUsername(username);
      if (!user) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const token = signToken({ sub: user.id, username: user.username });
      res.json({ token, user: { id: user.id, username: user.username } });
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Current user info (authenticated)
  router.get("/me", requireAuth, (req, res) => {
    const auth = (req as any).auth;
    res.json({ id: auth.sub, username: auth.username });
  });

  return router;
}
