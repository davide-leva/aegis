import os from "node:os";

export type SystemNetworkInterface = {
  name: string;
  address: string;
  family: "ipv4" | "ipv6";
};

export function listSystemNetworkInterfaces(): SystemNetworkInterface[] {
  const interfaces = os.networkInterfaces();
  const items: SystemNetworkInterface[] = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) {
        continue;
      }
      const family = entry.family === "IPv6" ? "ipv6" : entry.family === "IPv4" ? "ipv4" : null;
      if (!family) {
        continue;
      }
      items.push({
        name,
        address: entry.address,
        family
      });
    }
  }

  return items.sort((left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address));
}
