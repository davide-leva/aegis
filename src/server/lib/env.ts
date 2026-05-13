import dotenv from "dotenv";

dotenv.config();

export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:5000",
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 5000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  sqlitePath: process.env.SQLITE_PATH ?? "./data/aegis.db",
  jwtSecret: process.env.JWT_SECRET ?? "change-me-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "24h"
};

export const isProduction = env.nodeEnv === "production";
