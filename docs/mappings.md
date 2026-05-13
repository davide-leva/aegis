---
layout: page
title: Mappings
---

# Mappings

Mappings are the glue between discovered container ports and the proxy routes that expose them.

They are worth treating as their own concept because they make it possible to track which route was created on behalf of which container port.

## Mapping Contents

A Docker mapping stores:

- The Docker environment
- The container identifier and container name
- The private container port
- The optional public port
- The transport protocol
- The linked proxy route

This record lets Aegis distinguish between:

- A route an operator created manually
- A route Aegis generated as part of Docker automation

## Why Mappings Exist

Mappings enable several important behaviors:

- Reconciliation of automapped services over time
- Cleanup when a container is removed
- Event reporting for automap success and failure
- Traceability from a route back to its Docker source

Without a mapping table, automapping would be much harder to reverse safely.

## Lifecycle

The usual mapping lifecycle is:

1. A container is discovered or manually selected.
2. Aegis determines which port should be exposed.
3. DNS and certificate prerequisites are created or reused.
4. A proxy route is created.
5. A mapping record links the route to the container port.
6. If the container later disappears, the mapping can be released and the managed route cleaned up.

## Cleanup Rules

When a managed mapping is released, Aegis can remove:

- The linked proxy route
- The managed DNS record, if no remaining route still uses that hostname
- The managed certificate, when it is no longer referenced

This keeps Docker-driven automation from leaving behind operational drift.

## Manual and Automatic Operations

Mappings can be created manually through the Docker mapping API or generated automatically through automapping. In either case, the mapping object is the durable link that allows later cleanup and inspection.
