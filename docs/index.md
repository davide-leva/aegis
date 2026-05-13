---
layout: page
title: Aegis Docs
permalink: /
---

# Aegis Documentation

Aegis is a single-container control plane for LAN-facing infrastructure. It brings together DNS management, reverse proxying, certificate lifecycle, and Docker service discovery in one operational surface.

This documentation is organized by capability so operators and contributors can move directly to the part of the system they need.

## Start Here

- [Introduction](./introduction.md) for the product model, architecture, and request flow
- [Development](./development.md) for local setup, runtime internals, and extension points

## Feature Guides

- [DNS](./dns.md)
- [Certificates and ACME](./certificates.md)
- [Proxy](./proxy.md)
- [Docker Discovery](./docker-discovery.md)
- [Mappings](./mappings.md)
- [Settings and Access Control](./settings-and-access.md)
- [System and Runtime](./system.md)

## What Aegis Manages

- Bootstrap and operator authentication
- Local DNS zones, records, upstream resolvers, and blocklists
- Internal certificate authorities and ACME-issued certificates
- HTTP, HTTPS, TCP, and UDP proxy routes
- Docker environment registration and label-driven automapping
- API keys, event streams, runtime reloads, and health monitoring
