import type { DatabaseContext } from "../types.js";

export function boolValue(value: boolean, db: DatabaseContext) {
  return db.driver === "postgres" ? value : value ? 1 : 0;
}

export function placeholder(index: number, db: DatabaseContext) {
  return db.driver === "postgres" ? `$${index}` : "?";
}

export function mapRecord<T extends Record<string, unknown>>(row: T | undefined): T | undefined {
  if (!row) {
    return row;
  }

  const clone = { ...row } as Record<string, unknown>;
  for (const [key, value] of Object.entries(clone)) {
    if (value === 0 || value === 1) {
      if (key.startsWith("is") || key === "enabled" || key === "active" || key === "blocklistEnabled" || key === "preserveHost") {
        clone[key] = Boolean(value);
      }
    }
  }

  return clone as T;
}

export function mapRows<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map((row) => mapRecord(row) as T);
}

export async function resolveInsertedId(db: DatabaseContext, lastInsertId?: number) {
  if (lastInsertId) {
    return lastInsertId;
  }

  if (db.driver === "sqlite") {
    return (await db.get<{ id: number }>("SELECT last_insert_rowid() AS id"))?.id;
  }

  return undefined;
}
