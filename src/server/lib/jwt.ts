import jwt from "jsonwebtoken";

import { env } from "./env.js";

export type JwtPayload = {
  sub: number;
  username: string;
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as unknown as JwtPayload;
}
