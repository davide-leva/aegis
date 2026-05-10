import type { AuditContext, EventTopic } from "../types.js";
import type { Repositories } from "../repositories/index.js";

export class EventBus {
  constructor(private readonly repositories: Repositories) {}

  async publish(input: {
    topic: EventTopic;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    context: AuditContext;
  }) {
    return this.repositories.events.create({
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
  }
}
