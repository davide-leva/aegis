---
layout: page
title: Certificates and ACME
---

# Certificates and ACME

Aegis supports two certificate stories in parallel:

- Internal certificate authority and server certificate management
- Public ACME issuance for externally trusted HTTPS mappings

This split is intentional. LAN environments often need both private trust for internal infrastructure and public trust for user-facing names.

## Internal PKI

The internal PKI side of the product manages:

- Certificate subjects
- Certificate authorities
- Server certificates
- Renewal and download flows

This gives operators a private trust chain they can use for internal services, internal tooling, or environments where public issuance is not appropriate.

## ACME Integration

For public or Cloudflare-backed hostnames, Aegis can issue certificates through ACME. This path is especially important for Docker automapping and HTTPS proxy routes.

The ACME flow depends on:

- An ACME account
- A Cloudflare credential
- An imported zone linked to that credential
- A hostname that matches one of the managed zones

When these pieces are present, Aegis can request and store certificate material without requiring a manual certificate upload step.

## How HTTPS Mappings Use Certificates

When an HTTPS route is created through the Docker mapping flow:

- Aegis normalizes the DNS hostname
- It checks whether a valid ACME certificate already exists for that hostname
- If none exists, it resolves the matching imported zone and Cloudflare credential
- It issues a new certificate and stores it in the ACME certificate repository
- The proxy route receives the resulting certificate and key material

This allows the proxy layer to terminate TLS while the certificate lifecycle remains managed centrally.

## Renewal

Renewal is handled by a background service. The goal is that operators should not need to reissue certificates manually during normal operation.

The renewal subsystem works alongside:

- Certificate storage repositories
- The proxy runtime manager, which needs fresh certificates to be applied
- The WebSocket event layer, which can refresh certificate views in the UI

## Downloads and Material Access

The API exposes endpoints for downloading stored certificate material. This is useful for interoperability with external systems, but it also means access control matters.

In practice, certificate operations should be limited to trusted operators or scoped API keys with appropriate certificate access.

## Operational Notes

Certificate management touches multiple trust boundaries:

- Database confidentiality for stored key material
- Access control on certificate APIs
- Correct Cloudflare credential management
- Safe runtime reloads after issuance or renewal

In Aegis, certificates are not an isolated feature. They are a dependency of secure routing and an integral part of service automation.
