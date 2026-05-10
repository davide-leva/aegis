# Aegis

Aegis is a single-container control plane for enterprise LAN services. This first slice focuses on DNS administration:

- bootstrap setup for the DNS service
- local zones and DNS records management
- upstream resolver configuration
- blocklist management
- PostgreSQL in production or SQLite fallback for development

## Development

```bash
npm install
npm run dev
```

The API is served under `/api` and the Vite frontend runs in development on port `5173`.
