---
layout: page
title: Development
---

# Development

This page is for contributors who want to run, extend, or debug Aegis locally.

## Local Setup

The current development flow is intentionally small:

```bash
npm install
npm run dev
```

The API is served under `/api` and the frontend runs through Vite during development.

## Repository Shape

The project is split into two main application surfaces:

- `src/server` for the API, persistence, runtime managers, and background services
- `src/client` for the React control plane UI

Inside the server, the code is further separated into:

- `routes` for HTTP entrypoints
- `services` for domain orchestration
- `repositories` for database access
- `db` for database client and migrations
- `dns` and `proxy` for runtime workers and managers
- `lib` for lower-level helpers
- `events` and `ws` for event propagation and UI invalidation

## Backend Architecture

The backend follows a fairly direct flow:

1. A route validates and accepts the request.
2. A service coordinates the domain logic.
3. Repositories persist or fetch data.
4. Audit and event entries are written.
5. Runtime managers reload when needed.

This makes most feature work easy to trace through the codebase.

## Frontend Architecture

The frontend is a React SPA organized around top-level product areas such as DNS, certificates, proxy, Docker, mappings, and settings.

Most pages talk to the API and rely on live invalidation behavior so they can refresh when the backend publishes relevant events.

## Database and Migrations

Database schema changes are managed through the server migration layer. The project supports:

- PostgreSQL for production-style deployments
- SQLite as a lightweight development fallback

When changing data models, prefer updating repositories and services together so runtime logic and persistence remain aligned.

## Runtime and Live Reload Concepts

Not every code path affects live traffic. When you work on:

- DNS settings
- Proxy routes
- Certificates tied to active routes
- Docker automapping

you should pay attention to whether the relevant runtime manager needs to reload. In Aegis, persistence alone is often not the full feature change.

## Docker-Driven Features

If you are touching Docker discovery code, keep the whole lifecycle in mind:

- Detection
- Analysis
- Mapping creation
- Event publication
- Cleanup and reconciliation

The safest fixes usually preserve that full chain instead of only patching the immediate insertion point.

## Operational Debugging Tips

- Check route and service repositories first when behavior looks correct in the UI but wrong at runtime.
- Check emitted events when the UI fails to refresh after a backend change.
- Check watcher and reconciliation logic for Docker edge cases such as renamed or replaced containers.
- Check privileged-port access on Linux when DNS or proxy listeners fail to start.

## Documentation Strategy

This `docs/` folder is intended to stay close to the codebase and evolve with the product. When a feature changes meaningfully, update:

- The relevant feature page
- The introduction page if the architecture or product model changed
- This development page if contributor workflows changed
