import type { AuditContext, EventTopic } from "../types.js";
import type { Repositories } from "../repositories/index.js";
import type { WsGateway } from "../ws/gateway.js";

const TOPIC_KEYS: Record<string, string[]> = {
  "dns.runtime.": ["dns-runtime-status", "dns-runtime-events"],
  "proxy.runtime.": ["proxy-runtime-status", "proxy-runtime-events"],
  "docker.": ["docker-dashboard", "docker-containers"],
  "dns.": ["dns-dashboard"],
  "proxy.": ["proxy-dashboard"],
  "certificate.": ["certificates-dashboard", "server-certificates", "certificate-authorities"]
};

function resolveKeys(topic: string): string[] {
  for (const [prefix, keys] of Object.entries(TOPIC_KEYS)) {
    if (topic.startsWith(prefix)) return keys;
  }
  return [];
}

const noopGateway: Pick<WsGateway, "broadcast"> = { broadcast: () => {} };

export class EventBus {
  private readonly gateway: Pick<WsGateway, "broadcast">;

  constructor(
    private readonly repositories: Repositories,
    gateway?: WsGateway
  ) {
    this.gateway = gateway ?? noopGateway;
  }

  async publish(input: {
    topic: EventTopic;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    context: AuditContext;
  }) {
    const event = await this.repositories.events.create({
      topic: input.topic,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      metadata: {
        actorType: input.context.actorType,
        actorId: input.context.actorId,
        sourceIp: input.context.sourceIp,
        userAgent: input.context.userAgent
      }
    });

    const keys = resolveKeys(input.topic);
    if (keys.length > 0) this.gateway.broadcast(keys);

    return event;
  }
}
