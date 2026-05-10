import type { DatabaseContext, DockerPortMapping } from "../types.js";
import { mapRecord, mapRows, placeholder, resolveInsertedId } from "./helpers.js";

export type NewDockerPortMapping = Omit<DockerPortMapping, "id" | "createdAt" | "updatedAt" | "proxyRouteName">;

export class DockerPortMappingRepository {
  constructor(private readonly db: DatabaseContext) {}

  async getById(id: number) {
    const row = await this.db.get<DockerPortMapping & Record<string, unknown>>(
      `SELECT
        mapping.id,
        mapping.environment_id AS "environmentId",
        mapping.container_id AS "containerId",
        mapping.container_name AS "containerName",
        mapping.private_port AS "privatePort",
        mapping.public_port AS "publicPort",
        mapping.protocol,
        mapping.proxy_route_id AS "proxyRouteId",
        route.name AS "proxyRouteName",
        mapping.created_at AS "createdAt",
        mapping.updated_at AS "updatedAt"
      FROM docker_port_mappings mapping
      LEFT JOIN proxy_routes route ON route.id = mapping.proxy_route_id
      WHERE mapping.id = ${placeholder(1, this.db)}`,
      [id]
    );
    return mapRecord(row);
  }

  async listByEnvironment(environmentId: number): Promise<DockerPortMapping[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        mapping.id,
        mapping.environment_id AS "environmentId",
        mapping.container_id AS "containerId",
        mapping.container_name AS "containerName",
        mapping.private_port AS "privatePort",
        mapping.public_port AS "publicPort",
        mapping.protocol,
        mapping.proxy_route_id AS "proxyRouteId",
        route.name AS "proxyRouteName",
        mapping.created_at AS "createdAt",
        mapping.updated_at AS "updatedAt"
      FROM docker_port_mappings mapping
      LEFT JOIN proxy_routes route ON route.id = mapping.proxy_route_id
      WHERE mapping.environment_id = ${placeholder(1, this.db)}
      ORDER BY mapping.container_name ASC, mapping.private_port ASC`,
      [environmentId]
    );
    return mapRows(rows) as unknown as DockerPortMapping[];
  }

  async listAll(): Promise<DockerPortMapping[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT
        mapping.id,
        mapping.environment_id AS "environmentId",
        mapping.container_id AS "containerId",
        mapping.container_name AS "containerName",
        mapping.private_port AS "privatePort",
        mapping.public_port AS "publicPort",
        mapping.protocol,
        mapping.proxy_route_id AS "proxyRouteId",
        route.name AS "proxyRouteName",
        mapping.created_at AS "createdAt",
        mapping.updated_at AS "updatedAt"
      FROM docker_port_mappings mapping
      LEFT JOIN proxy_routes route ON route.id = mapping.proxy_route_id
      ORDER BY mapping.created_at DESC`
    );
    return mapRows(rows) as unknown as DockerPortMapping[];
  }

  async create(input: NewDockerPortMapping) {
    const now = new Date().toISOString();
    const values = [
      input.environmentId,
      input.containerId,
      input.containerName,
      input.privatePort,
      input.publicPort,
      input.protocol,
      input.proxyRouteId,
      now,
      now
    ];
    const markers = values.map((_, index) => placeholder(index + 1, this.db)).join(", ");
    const returning = this.db.driver === "postgres" ? " RETURNING id" : "";
    const result = await this.db.run(
      `INSERT INTO docker_port_mappings (
        environment_id,
        container_id,
        container_name,
        private_port,
        public_port,
        protocol,
        proxy_route_id,
        created_at,
        updated_at
      ) VALUES (${markers})${returning}`,
      values
    );
    const id = await resolveInsertedId(this.db, result.lastInsertId);
    return this.getById(Number(id));
  }
}
