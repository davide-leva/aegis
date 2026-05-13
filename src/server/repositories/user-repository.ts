import type { DatabaseContext } from "../types.js";
import { placeholder, resolveInsertedId } from "./helpers.js";

export type User = {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
};

export class UserRepository {
  constructor(private readonly db: DatabaseContext) {}

  async findByUsername(username: string): Promise<User | undefined> {
    return this.db.get<User>(
      `SELECT id, username, password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE username = ${placeholder(1, this.db)}`,
      [username]
    );
  }

  async findById(id: number): Promise<User | undefined> {
    return this.db.get<User>(
      `SELECT id, username, password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
  }

  async count(): Promise<number> {
    const row = await this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM users`
    );
    return Number(row?.count ?? 0);
  }

  async create(input: { username: string; passwordHash: string }): Promise<User> {
    const now = new Date().toISOString();
    const values = [input.username, input.passwordHash, now, now];
    const markers = values.map((_, i) => placeholder(i + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.db.get<User>(
      `SELECT id, username, password_hash AS "passwordHash", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE id = ${placeholder(1, this.db)}`,
      [id]
    ) as Promise<User>;
  }
}
