---
layout: page
title: Settings and Access Control
---

# Settings and Access Control

This part of Aegis covers the operator-facing control surfaces that are not tied to one traffic feature.

## Authentication Model

Aegis starts with a setup flow and then exposes a login-based operator experience. Public auth endpoints handle:

- Initial setup
- Login
- Session identity checks

After authentication, the remaining API is protected by middleware that accepts either:

- JWT-backed operator access
- API keys with scopes

## API Keys

API keys provide programmable access to the control plane. They are especially useful for automation, external workflows, and internal integrations.

Keys can be created with:

- A name
- An optional expiration
- A set of scopes

Scopes are important because Aegis separates sensitive areas such as certificate management from broad administrative control.

## Config Groups

The config API exposes grouped configuration records intended for administrative settings that do not belong inside a more specialized module.

This gives the product a generic administrative configuration surface without forcing every setting into a one-off endpoint.

## Cloudflare Credentials

Cloudflare credentials are managed through the settings surface because they are a shared dependency for:

- Zone imports
- ACME DNS challenges
- Automated HTTPS issuance

Treat these credentials as high-sensitivity operational secrets. They unlock certificate automation and zone synchronization behavior.

## Events and Auditability

Although the richer audit trail UI is not fully exposed yet, the system already records:

- Audit entries for important administrative actions
- Domain events used for live UI refresh and operational visibility

This is an important design choice. Aegis is not only a CRUD API; it is intended to be an operational control plane with traceable state transitions.
