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

### Linux dev on privileged ports

Aegis can bind real networking ports like `53`, `80`, and `443` during development. On Linux those ports require either `root` or the `CAP_NET_BIND_SERVICE` capability.

Use capability on the Node binary instead of running the whole stack with `sudo`:

```bash
sudo setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(which node)")"
getcap "$(readlink -f "$(which node)")"
```

If you change Node version or upgrade the binary, repeat the `setcap` step because the capability is attached to the resolved executable path.

To remove the capability again:

```bash
sudo setcap -r "$(readlink -f "$(which node)")"
```

Running `sudo npm run dev` is discouraged as a normal workflow because it elevates the whole toolchain instead of only allowing privileged port binds.
