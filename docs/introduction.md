---
layout: page
title: Introduction
---

# Introduction

> [!WARNING]
> Aegis is currently under active development. It is not designed for exposure to the public internet and should not be treated as production-ready for critical environments. Parts of the project were also code-vibed, so behavior, security posture, and operational guarantees should be considered incomplete until the platform matures.

Aegis is designed as an opinionated control plane for self-hosted network services. Instead of treating DNS, certificates, proxy routing, and container discovery as isolated tools, it coordinates them as one workflow.

The key idea is simple: describe how a service should be reachable, and Aegis keeps the surrounding infrastructure aligned.

## Core Model

Aegis currently revolves around a few main domains:

- DNS management for local and imported zones
- Certificate management for private PKI and ACME-based public certificates
- Proxy routing for HTTP, HTTPS, TCP, and UDP traffic
- Docker-backed service discovery and port-to-route automapping
- Operational controls such as API keys, audit events, and runtime status

Each domain has its own API and UI surface, but they are linked by shared data in the database and shared runtime managers.

## High-Level Architecture

At runtime, Aegis is made of these layers:

- An Express API that exposes the control plane under `/api`
- A React frontend served by the same process in production
- A persistence layer backed by PostgreSQL or SQLite
- A DNS runtime worker for answering DNS traffic
- A proxy runtime worker for forwarding external traffic
- Background services for Docker watching, certificate renewal, and health checks
- A WebSocket gateway used to invalidate or refresh client views when state changes

The API is the source of truth. The runtime workers consume normalized database state and are reloaded when relevant configuration changes.

## Request and State Flow

Most changes follow the same path:

1. A user or API client sends a request to the Express API.
2. The related service validates and normalizes the input.
3. Repositories persist the change inside the database.
4. Audit records and domain events are emitted.
5. Runtime managers are asked to reload if the change affects live traffic.
6. The frontend is notified through the event gateway and refreshes the relevant views.

This pattern keeps the control plane auditable and helps runtime behavior stay deterministic.

## How the Domains Fit Together

The strongest example of cross-domain behavior is Docker automapping:

- A container exposes one or more ports.
- Aegis inspects labels such as `aegis.host` or `aegis.<service>.host`.
- A DNS record is created or reused.
- A proxy route is created or updated.
- An HTTPS certificate can be issued if the mapping requires TLS.
- A Docker mapping record links the discovered container port to the managed proxy route.

The result is that discovery, routing, DNS, and certificates behave like one feature instead of four manual steps.

## Intended Use

Aegis is best suited for:

- Homelabs that want a single control plane for ingress and internal name resolution
- Small teams running self-hosted LAN services
- Environments where operational clarity is more important than maximum configurability
- Setups that benefit from turning container metadata into network configuration automatically

## Current Scope

The product already includes broad support for DNS, proxying, certificates, and Docker discovery. Some navigation items in the UI still indicate future areas such as network policy and a richer audit experience, so the software should be treated as an evolving control plane rather than a finished platform.
