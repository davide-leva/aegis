import { listSystemNetworkInterfaces } from "../lib/system-network-interfaces.js";
import type { AuditContext } from "../types.js";
import type { NewNetworkInterface } from "../repositories/network-interface-repository.js";
import type { Repositories } from "../repositories/index.js";
import { createRepositories } from "../repositories/index.js";

export type BootstrapNetworkInterfaceInput = {
  name: string;
  address: string;
  family: "ipv4" | "ipv6";
  enabled: boolean;
  isDefault: boolean;
};

export class NetworkInterfaceService {
  constructor(private readonly repositories: Repositories) {}

  async list(context: AuditContext) {
    const interfaces = await this.repositories.networkInterfaces.list();
    await this.repositories.audit.create({
      action: "network.interface.list",
      entityType: "network_interface",
      entityId: null,
      payload: { count: interfaces.length },
      context
    });
    return {
      availableInterfaces: listSystemNetworkInterfaces(),
      interfaces
    };
  }

  async save(input: BootstrapNetworkInterfaceInput[], context: AuditContext) {
    if (input.length === 0 || !input.some((entry) => entry.enabled)) {
      throw new Error("Configure at least one enabled network interface");
    }
    if (input.filter((entry) => entry.isDefault && entry.enabled).length !== 1) {
      throw new Error("Configure exactly one default enabled network interface");
    }

    const available = new Set(listSystemNetworkInterfaces().map((entry) => `${entry.name}:${entry.address}:${entry.family}`));
    for (const entry of input) {
      if (!available.has(`${entry.name}:${entry.address}:${entry.family}`)) {
        throw new Error(`Network interface ${entry.name} ${entry.address} is not available on this machine`);
      }
    }

    return this.repositories.db.transaction(async (trx) => {
      const repos = createRepositories(trx);
      const created = await repos.networkInterfaces.replaceAll(
        input.map((entry) => ({
          ...entry
        }) satisfies NewNetworkInterface)
      );
      await repos.audit.create({
        action: "network.interface.sync",
        entityType: "network_interface",
        entityId: null,
        payload: {
          count: created.length,
          default: created.find((entry) => entry.isDefault)?.address ?? null
        },
        context
      });
      return created;
    });
  }
}
