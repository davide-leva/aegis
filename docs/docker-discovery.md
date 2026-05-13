---
layout: page
title: Docker Discovery
---

# Docker Discovery

The Docker module connects Aegis to one or more Docker environments and turns container metadata into managed network configuration.

This is one of the most opinionated parts of the product and one of the clearest examples of why Aegis exists.

## What the Docker Module Does

The module provides:

- Docker environment registration
- Container listing and inspection
- Resource statistics by environment
- Label-driven automapping
- Cleanup of managed mappings when containers disappear

## Environments

A Docker environment defines how Aegis reaches a Docker API. It can be configured for:

- Local socket access
- Remote host access
- TLS-secured remote access

Each environment also carries the public IP that Aegis should use when creating DNS records for discovered services.

## Automapping

Automapping reads `aegis.*` labels from containers and turns them into candidate mappings.

Examples of supported patterns include:

- `aegis.host`
- `aegis.protocol`
- `aegis.port`
- `aegis.<service>.host`
- `aegis.<service>.protocol`
- `aegis.<service>.port`

The analyzer then:

1. Reads the label definitions.
2. Chooses the matching exposed port.
3. Infers the route protocol when possible.
4. Chooses the default network interface for listening.
5. Creates or reuses DNS and certificate resources as needed.
6. Creates the proxy route and the Docker mapping record.

## Watchers and Reconciliation

Aegis does not only react to manual requests. It also keeps a live watcher on enabled Docker environments.

The watcher responds to:

- Container start events, which can trigger automapping
- Container destroy events, which can trigger cleanup

In addition to live events, environment reconciliation is used to align the stored state with the actual set of containers. This is important when:

- Aegis was offline while a container changed
- A container was renamed or replaced
- A previous mapping record outlived the original container

## Failure Handling

Automapping can fail for several expected reasons:

- The requested port is invalid
- A specified port is not exposed
- Multiple ports exist and no explicit mapping port was provided
- Protocol expectations do not match the exposed transport
- No default network interface is available

These failures are surfaced as events so the UI can explain why a mapping was skipped.

## Why Docker Discovery Matters

Without this module, operators would need to create DNS, certificates, and proxy routes manually for every containerized service. With Docker discovery, a container can describe its reachability in labels and let Aegis translate that into infrastructure state.
