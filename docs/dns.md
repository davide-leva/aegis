---
layout: page
title: DNS
---

# DNS

The DNS module is the foundation of Aegis. It provides the naming layer that other features build on, especially Docker discovery and HTTP/HTTPS routing.

## Responsibilities

The DNS service is responsible for:

- Bootstrap state and default resolver settings
- Local zone creation and editing
- DNS record lifecycle management
- Upstream resolver configuration
- Blocklist rule management
- Exposing DNS runtime status and dashboard data

## Bootstrap Flow

The product begins with DNS bootstrap. This initializes operator-facing settings and establishes the initial assumptions the rest of the stack uses.

Bootstrap endpoints and UI flows cover:

- General resolver settings
- Initial certificate authority setup for the private PKI path
- Completion status needed before the wider system is considered ready

Because DNS is part of the initial setup, it acts as both a feature area and a prerequisite for other modules.

## Zones

Zones define the authoritative spaces Aegis manages. A zone can be:

- Local, where Aegis owns and serves records directly
- Forward-oriented, where the zone is represented for management purposes but traffic is delegated elsewhere

Zones can also carry flags that indicate whether they are primary or reverse-oriented. The system uses enabled local zones when deciding where an automatically generated record should live.

## Records

Records are the concrete answers returned by the DNS runtime. The system supports common record management through the control plane and can associate records with a proxied service when the record is created as part of a mapping workflow.

That association matters because it lets Aegis reason about cleanup:

- If a Docker mapping disappears, Aegis can determine whether the generated record is still needed.
- If no route still references the hostname, the managed record can be removed automatically.

## Upstreams

The upstream resolver module allows Aegis to forward queries it is not authoritative for. This is where operators configure redundancy, protocol choice, and priority of external resolvers.

Operationally, upstreams make Aegis useful as both:

- An authority for selected local zones
- A recursive or forwarding layer for everything else

## Blocklist

The blocklist feature gives operators a policy surface for domains or patterns that should be intercepted. Entries can be stored as direct domains, suffixes, or regular expressions.

This keeps policy and resolution in the same plane instead of pushing filtering out to another appliance.

## Runtime Behavior

The DNS runtime reads from persisted configuration rather than from ad hoc memory state. When DNS-related changes are committed:

- Audit and event entries are written
- The DNS runtime manager can reload its worker
- The frontend can refresh dashboard and list data through event invalidation

This makes the DNS layer predictable and observable even as settings change live.
