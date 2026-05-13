---
layout: page
title: Proxy
---

# Proxy

The proxy module is the traffic entrypoint for services managed by Aegis. It converts stored routing rules into live listeners and forwards traffic to the correct backend target.

## Supported Route Types

Proxy routes can be defined for:

- HTTP
- HTTPS
- TCP
- UDP

This lets Aegis cover both web workloads and lower-level service forwarding.

## Route Model

A proxy route stores the information needed to listen and forward traffic:

- Route name
- Protocol
- Network interface assignment
- Listen address and listen port
- Source host and optional source path
- Target host, target port, and target protocol
- Host header preservation behavior
- TLS material for HTTPS routes
- Enablement and health status

This model is rich enough to support manual route management and generated routes coming from Docker mappings.

## Runtime Execution

The proxy runtime is managed by a dedicated runtime manager and worker. The control plane persists the desired state, and the runtime worker applies it.

This separation gives Aegis a few advantages:

- Configuration changes can be audited before they affect live traffic
- Runtime reloads can happen after batches of changes
- The worker stays focused on traffic handling rather than UI or business logic

## Health Monitoring

The system includes a proxy health checker that evaluates route targets and updates route health status. This gives operators a quick signal that a route exists but its backend may not currently be serving correctly.

Health is therefore treated as part of route state, not just as an external monitoring concern.

## Manual vs Generated Routes

Routes can come from two sources:

- Manual creation in the proxy area
- Automatic creation through Docker discovery and mappings

Generated routes are especially useful because they can inherit supporting resources such as DNS records and HTTPS certificates.

## Event and Audit Integration

When routes are created, updated, or deleted:

- Audit records are written
- Domain events are published
- The proxy runtime can be reloaded
- Client dashboards can refresh via WebSocket invalidation

That event chain is what makes the control plane feel reactive while still being driven by persisted state.
