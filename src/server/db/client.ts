import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import pg from "pg";

import { env } from "../lib/env.js";
import type { DatabaseContext, DatabaseDriver } from "../types.js";

const { Pool } = pg;

type SqliteRunner = DatabaseSync;
type PostgresRunner = pg.Pool | pg.PoolClient;

function normalizeRows<T>(rows: T[]): T[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object") {
      return row;
    }
    const normalized = { ...row } as Record<string, unknown>;
    for (const [key, value] of Object.entries(normalized)) {
      if (typeof value === "bigint") {
        normalized[key] = Number(value);
      }
    }
    return normalized as T;
  });
}

function ensureSqlitePath(sqlitePath: string) {
  const dir = path.dirname(sqlitePath);
  fs.mkdirSync(dir, { recursive: true });
}

function createSqliteContextFromRunner(db: SqliteRunner): DatabaseContext {
  return {
    driver: "sqlite",
    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
    },
    async get<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined;
    },
    async run(sql: string, params: unknown[] = []) {
      const result = db.prepare(sql).run(...(params as SQLInputValue[]));
      return {
        lastInsertId: Number(result.lastInsertRowid)
      };
    },
    async transaction<T>(callback: (trx: DatabaseContext) => Promise<T>) {
      db.exec("BEGIN");
      try {
        const result = await callback(createSqliteContextFromRunner(db));
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  };
}

function createSqliteContext(): DatabaseContext {
  ensureSqlitePath(env.sqlitePath);
  const db = new DatabaseSync(env.sqlitePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return createSqliteContextFromRunner(db);
}

function createPostgresContextFromRunner(runner: PostgresRunner, pool?: pg.Pool): DatabaseContext {
  return {
    driver: "postgres",
    async all<T>(sql: string, params: unknown[] = []) {
      const result = await runner.query(sql, params);
      return normalizeRows(result.rows as T[]);
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const result = await runner.query(sql, params);
      return normalizeRows(result.rows as T[])[0];
    },
    async run(sql: string, params: unknown[] = []) {
      const result = await runner.query(sql, params);
      const row = result.rows[0] as { id?: number } | undefined;
      return {
        lastInsertId: row?.id
      };
    },
    async transaction<T>(callback: (trx: DatabaseContext) => Promise<T>) {
      const transactionPool = pool ?? (runner as pg.Pool);
      const client = await transactionPool.connect();
      try {
        await client.query("BEGIN");
        const result = await callback(createPostgresContextFromRunner(client, transactionPool));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

function createPostgresContext(): DatabaseContext {
  const pool = new Pool({
    connectionString: env.databaseUrl
  });
  return createPostgresContextFromRunner(pool, pool);
}

export function createDb(): DatabaseContext {
  const driver: DatabaseDriver = env.databaseUrl ? "postgres" : "sqlite";
  return driver === "postgres" ? createPostgresContext() : createSqliteContext();
}
