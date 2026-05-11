import type { DatabaseContext, NetworkInterface } from "../types.js";
import { boolValue, mapRecord, mapRows, placeholder, resolveInsertedId } from "./helpers.js";

export type NewNetworkInterface = {
  name: string;
  address: string;
  family: "ipv4" | "ipv6";
  enabled: boolean;
  isDefault: boolean;
};

export class NetworkInterfaceRepository {
  constructor(private readonly db: DatabaseContext) {}

  async list(): Promise<NetworkInterface[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        id,
        name,
        address,
        family,
        enabled,
        is_default AS "isDefault",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM network_interfaces
      ORDER BY is_default DESC, name ASC, address ASC`
    );
    return mapRows(rows) as unknown as NetworkInterface[];
  }

  async getById(id: number) {
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT
        id,
        name,
        address,
        family,
        enabled,
        is_default AS "isDefault",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM network_interfaces
      WHERE id = ${placeholder(1, this.db)}`,
      [id]
    );
    return (mapRecord(row) as NetworkInterface | undefined) ?? null;
  }

  async getDefault() {
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT
        id,
        name,
        address,
        family,
        enabled,
        is_default AS "isDefault",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM network_interfaces
      WHERE enabled = ${placeholder(1, this.db)} AND is_default = ${placeholder(2, this.db)}
      ORDER BY id ASC
      LIMIT 1`,
      [boolValue(true, this.db), boolValue(true, this.db)]
    );
    return (mapRecord(row) as NetworkInterface | undefined) ?? null;
  }

  async replaceAll(items: NewNetworkInterface[]) {
    const now = new Date().toISOString();
    await this.db.run("DELETE FROM network_interfaces");
    const created: NetworkInterface[] = [];

    for (const item of items) {
      const values = [
        item.name,
        item.address,
        item.family,
        boolValue(item.enabled, this.db),
        boolValue(item.isDefault, this.db),
        now,
        now
      ];
      const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
      const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
      const result = await this.db.run(
        `INSERT INTO network_interfaces (
          name,
          address,
          family,
          enabled,
          is_default,
          created_at,
          updated_at
        ) VALUES (${markers})${returning}`,
        values
      );
      const id = await resolveInsertedId(this.db, result.lastInsertId);
      const next = await this.getById(Number(id));
      if (next) {
        created.push(next);
      }
    }

    return created;
  }
}
