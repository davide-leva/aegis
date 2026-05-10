import dotenv from "dotenv";

dotenv.config();

export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:5000",
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 5000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  sqlitePath: process.env.SQLITE_PATH ?? "./data/aegis.db"
};

export const isProduction = env.nodeEnv === "production";
