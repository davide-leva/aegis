---
layout: page
title: System and Runtime
---

# System and Runtime

The System area explains how Aegis interacts with the host environment and how live runtime components are coordinated.

## Network Interfaces

Network interfaces are stored as first-class records because proxy routes and automapped services need a clear listening target.

The system can maintain:

- Interface name
- Address
- Address family
- Enabled status
- Default status

The default interface is especially important for Docker automapping. If it is missing, Aegis can detect candidate services but cannot safely create listener-backed routes for them.

## Privileged Ports

Aegis is designed to bind real service ports such as:

- `53` for DNS
- `80` for HTTP
- `443` for HTTPS

On Linux, these ports require elevated privileges or `CAP_NET_BIND_SERVICE`. The application checks for privileged-port access during startup and can fail early with a targeted error if the runtime does not have the required capability.

This protects operators from believing the system is active when key listeners could never come up.

## Runtime Managers

The live traffic plane is managed by dedicated runtime managers:

- `DnsRuntimeManager`
- `ProxyRuntimeManager`

These managers own the worker lifecycle and separate runtime execution from API request handling.

## Background Services

Several non-HTTP services run in the background:

- Docker environment watchers
- Proxy health checks
- Certificate renewal
- WebSocket event broadcasting

These services are what make Aegis feel continuous instead of request-only. They allow the control plane to react to environmental changes even when no operator is actively clicking in the UI.

## Frontend Delivery

In production, the Express process also serves the built frontend. This means the API and UI ship together as one deployable application, which fits the single-container operating model well.

## Operational Posture

The current design favors:

- A single deployable service
- Strong coupling between persisted state and runtime state
- Reactive reloads instead of ad hoc in-memory mutation
- Operational clarity over maximal abstraction

That posture makes the system easier to reason about during failures, restarts, and infrastructure changes.
