import type { DatabaseContext } from "../types.js";

export async function migrate(db: DatabaseContext) {
  const sqliteStatements = [
    `CREATE TABLE IF NOT EXISTS resolver_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_name TEXT NOT NULL,
      primary_contact_email TEXT NOT NULL,
      default_zone_suffix TEXT NOT NULL,
      upstream_mode TEXT NOT NULL,
      dns_listen_port INTEGER NOT NULL,
      blocklist_enabled INTEGER NOT NULL DEFAULT 1,
      setup_completed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dns_zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      description TEXT,
      is_primary INTEGER NOT NULL DEFAULT 1,
      is_reverse INTEGER NOT NULL DEFAULT 0,
      ttl INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dns_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      ttl INTEGER NOT NULL,
      priority INTEGER,
      proxied_service TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(zone_id) REFERENCES dns_zones(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS dns_upstreams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      port INTEGER NOT NULL,
      protocol TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100,
      health_status TEXT NOT NULL DEFAULT 'unknown',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS blocklist_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      source TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      source_ip TEXT,
      user_agent TEXT,
      payload TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS domain_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dns_query_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      protocol TEXT NOT NULL,
      client_ip TEXT,
      question_name TEXT NOT NULL,
      question_type TEXT NOT NULL,
      resolution_mode TEXT NOT NULL,
      response_code TEXT NOT NULL,
      answer_count INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      zone_name TEXT,
      upstream_name TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS network_interfaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      family TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS proxy_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      protocol TEXT NOT NULL,
      network_interface_id INTEGER,
      listen_address TEXT NOT NULL,
      listen_port INTEGER NOT NULL,
      source_host TEXT,
      source_path TEXT,
      target_host TEXT NOT NULL,
      target_port INTEGER NOT NULL,
      target_protocol TEXT NOT NULL,
      preserve_host INTEGER NOT NULL DEFAULT 1,
      tls_cert_pem TEXT,
      tls_key_pem TEXT,
      health_status TEXT NOT NULL DEFAULT 'unknown',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(network_interface_id) REFERENCES network_interfaces(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS proxy_request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER,
      route_name TEXT,
      protocol TEXT NOT NULL,
      client_ip TEXT,
      target_host TEXT,
      target_port INTEGER,
      outcome TEXT NOT NULL,
      status_code INTEGER,
      bytes_in INTEGER NOT NULL DEFAULT 0,
      bytes_out INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(route_id) REFERENCES proxy_routes(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS certificate_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_subject_id INTEGER,
      common_name TEXT NOT NULL,
      organization TEXT,
      organizational_unit TEXT,
      country TEXT,
      state TEXT,
      locality TEXT,
      email_address TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(parent_subject_id) REFERENCES certificate_subjects(id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE IF NOT EXISTS certificate_authorities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      subject_id INTEGER NOT NULL,
      issuer_ca_id INTEGER,
      certificate_pem TEXT NOT NULL,
      private_key_pem TEXT NOT NULL,
      serial_number TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      validity_days INTEGER NOT NULL,
      path_length INTEGER,
      is_self_signed INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(subject_id) REFERENCES certificate_subjects(id) ON DELETE RESTRICT,
      FOREIGN KEY(issuer_ca_id) REFERENCES certificate_authorities(id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE IF NOT EXISTS server_certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      subject_id INTEGER NOT NULL,
      ca_id INTEGER NOT NULL,
      subject_alt_names TEXT NOT NULL,
      certificate_pem TEXT NOT NULL,
      private_key_pem TEXT NOT NULL,
      chain_pem TEXT NOT NULL,
      serial_number TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      validity_days INTEGER NOT NULL,
      renewal_days INTEGER NOT NULL DEFAULT 30,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(subject_id) REFERENCES certificate_subjects(id) ON DELETE RESTRICT,
      FOREIGN KEY(ca_id) REFERENCES certificate_authorities(id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE IF NOT EXISTS docker_environments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      connection_type TEXT NOT NULL,
      socket_path TEXT,
      host TEXT,
      port INTEGER,
      tls_ca_pem TEXT,
      tls_cert_pem TEXT,
      tls_key_pem TEXT,
      public_ip TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS docker_port_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      environment_id INTEGER NOT NULL,
      container_id TEXT NOT NULL,
      container_name TEXT NOT NULL,
      private_port INTEGER NOT NULL,
      public_port INTEGER,
      protocol TEXT NOT NULL,
      proxy_route_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(environment_id) REFERENCES docker_environments(id) ON DELETE CASCADE,
      FOREIGN KEY(proxy_route_id) REFERENCES proxy_routes(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      expires_at TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS cloudflare_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      api_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS acme_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      directory_url TEXT NOT NULL,
      account_key_pem TEXT NOT NULL,
      account_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS acme_certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      acme_account_id INTEGER NOT NULL,
      cloudflare_credential_id INTEGER NOT NULL,
      domains TEXT NOT NULL,
      certificate_pem TEXT NOT NULL,
      private_key_pem TEXT NOT NULL,
      chain_pem TEXT NOT NULL,
      serial_number TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      renewal_days INTEGER NOT NULL DEFAULT 30,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(acme_account_id) REFERENCES acme_accounts(id) ON DELETE RESTRICT,
      FOREIGN KEY(cloudflare_credential_id) REFERENCES cloudflare_credentials(id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE IF NOT EXISTS config (
      group_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (group_id, key)
    )`
  ];

  const postgresStatements = [
    `CREATE TABLE IF NOT EXISTS resolver_settings (
      id SERIAL PRIMARY KEY,
      organization_name TEXT NOT NULL,
      primary_contact_email TEXT NOT NULL,
      default_zone_suffix TEXT NOT NULL,
      upstream_mode TEXT NOT NULL,
      dns_listen_port INTEGER NOT NULL,
      blocklist_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      setup_completed_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dns_zones (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      description TEXT,
      is_primary BOOLEAN NOT NULL DEFAULT TRUE,
      is_reverse BOOLEAN NOT NULL DEFAULT FALSE,
      ttl INTEGER NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dns_records (
      id SERIAL PRIMARY KEY,
      zone_id INTEGER NOT NULL REFERENCES dns_zones(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      ttl INTEGER NOT NULL,
      priority INTEGER,
      proxied_service TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dns_upstreams (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      port INTEGER NOT NULL,
      protocol TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      priority INTEGER NOT NULL DEFAULT 100,
      health_status TEXT NOT NULL DEFAULT 'unknown',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS blocklist_entries (
      id SERIAL PRIMARY KEY,
      pattern TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      source TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      source_ip TEXT,
      user_agent TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS domain_events (
      id SERIAL PRIMARY KEY,
      topic TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dns_query_logs (
      id SERIAL PRIMARY KEY,
      protocol TEXT NOT NULL,
      client_ip TEXT,
      question_name TEXT NOT NULL,
      question_type TEXT NOT NULL,
      resolution_mode TEXT NOT NULL,
      response_code TEXT NOT NULL,
      answer_count INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      zone_name TEXT,
      upstream_name TEXT,
      created_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS network_interfaces (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      family TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS proxy_routes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      protocol TEXT NOT NULL,
      network_interface_id INTEGER REFERENCES network_interfaces(id) ON DELETE SET NULL,
      listen_address TEXT NOT NULL,
      listen_port INTEGER NOT NULL,
      source_host TEXT,
      source_path TEXT,
      target_host TEXT NOT NULL,
      target_port INTEGER NOT NULL,
      target_protocol TEXT NOT NULL,
      preserve_host BOOLEAN NOT NULL DEFAULT TRUE,
      tls_cert_pem TEXT,
      tls_key_pem TEXT,
      health_status TEXT NOT NULL DEFAULT 'unknown',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS proxy_request_logs (
      id SERIAL PRIMARY KEY,
      route_id INTEGER REFERENCES proxy_routes(id) ON DELETE SET NULL,
      route_name TEXT,
      protocol TEXT NOT NULL,
      client_ip TEXT,
      target_host TEXT,
      target_port INTEGER,
      outcome TEXT NOT NULL,
      status_code INTEGER,
      bytes_in INTEGER NOT NULL DEFAULT 0,
      bytes_out INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS certificate_subjects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      parent_subject_id INTEGER REFERENCES certificate_subjects(id) ON DELETE RESTRICT,
      common_name TEXT NOT NULL,
      organization TEXT,
      organizational_unit TEXT,
      country TEXT,
      state TEXT,
      locality TEXT,
      email_address TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS certificate_authorities (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      subject_id INTEGER NOT NULL REFERENCES certificate_subjects(id) ON DELETE RESTRICT,
      issuer_ca_id INTEGER REFERENCES certificate_authorities(id) ON DELETE RESTRICT,
      certificate_pem TEXT NOT NULL,
      private_key_pem TEXT NOT NULL,
      serial_number TEXT NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      validity_days INTEGER NOT NULL,
      path_length INTEGER,
      is_self_signed BOOLEAN NOT NULL DEFAULT TRUE,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS server_certificates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      subject_id INTEGER NOT NULL REFERENCES certificate_subjects(id) ON DELETE RESTRICT,
      ca_id INTEGER NOT NULL REFERENCES certificate_authorities(id) ON DELETE RESTRICT,
      subject_alt_names JSONB NOT NULL,
      certificate_pem TEXT NOT NULL,
      private_key_pem TEXT NOT NULL,
      chain_pem TEXT NOT NULL,
      serial_number TEXT NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      validity_days INTEGER NOT NULL,
      renewal_days INTEGER NOT NULL DEFAULT 30,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS docker_environments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      connection_type TEXT NOT NULL,
      socket_path TEXT,
      host TEXT,
      port INTEGER,
      tls_ca_pem TEXT,
      tls_cert_pem TEXT,
      tls_key_pem TEXT,
      public_ip TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS docker_port_mappings (
      id SERIAL PRIMARY KEY,
      environment_id INTEGER NOT NULL REFERENCES docker_environments(id) ON DELETE CASCADE,
      container_id TEXT NOT NULL,
      container_name TEXT NOT NULL,
      private_port INTEGER NOT NULL,
      public_port INTEGER,
      protocol TEXT NOT NULL,
      proxy_route_id INTEGER NOT NULL REFERENCES proxy_routes(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      scopes JSONB NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS cloudflare_credentials (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      api_token TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS acme_accounts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      directory_url TEXT NOT NULL,
      account_key_pem TEXT NOT NULL,
      account_url TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS acme_certificates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      acme_account_id INTEGER NOT NULL REFERENCES acme_accounts(id) ON DELETE RESTRICT,
      cloudflare_credential_id INTEGER NOT NULL REFERENCES cloudflare_credentials(id) ON DELETE RESTRICT,
      domains JSONB NOT NULL,
      certificate_pem TEXT NOT NULL,
      private_key_pem TEXT NOT NULL,
      chain_pem TEXT NOT NULL,
      serial_number TEXT NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      renewal_days INTEGER NOT NULL DEFAULT 30,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS config (
      group_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (group_id, key)
    )`
  ];

  const statements = db.driver === "postgres" ? postgresStatements : sqliteStatements;

  for (const statement of statements) {
    await db.run(statement);
  }

  const alterStatements =
    db.driver === "postgres"
      ? [
          `ALTER TABLE certificate_authorities ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE`,
          `ALTER TABLE certificate_subjects ADD COLUMN parent_subject_id INTEGER REFERENCES certificate_subjects(id) ON DELETE RESTRICT`,
          `ALTER TABLE proxy_routes ADD COLUMN network_interface_id INTEGER REFERENCES network_interfaces(id) ON DELETE SET NULL`,
          `ALTER TABLE acme_accounts ADD COLUMN account_url TEXT`
        ]
      : [
          `ALTER TABLE certificate_authorities ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`,
          `ALTER TABLE certificate_subjects ADD COLUMN parent_subject_id INTEGER`,
          `ALTER TABLE proxy_routes ADD COLUMN network_interface_id INTEGER`,
          `ALTER TABLE acme_accounts ADD COLUMN account_url TEXT`
        ];

  for (const statement of alterStatements) {
    try {
      await db.run(statement);
    } catch {
      // ignore duplicate-column errors for existing databases
    }
  }

  const normalizeProxyRoutesStatement =
    db.driver === "postgres"
      ? `UPDATE proxy_routes
         SET
           listen_address = '0.0.0.0',
           listen_port = CASE
             WHEN protocol = 'http' THEN 80
             WHEN protocol = 'https' THEN 443
             ELSE listen_port
           END
         WHERE protocol IN ('http', 'https')
           AND (
             listen_address <> '0.0.0.0'
             OR (protocol = 'http' AND listen_port <> 80)
             OR (protocol = 'https' AND listen_port <> 443)
           )`
      : `UPDATE proxy_routes
         SET
           listen_address = '0.0.0.0',
           listen_port = CASE
             WHEN protocol = 'http' THEN 80
             WHEN protocol = 'https' THEN 443
             ELSE listen_port
           END
         WHERE protocol IN ('http', 'https')
           AND (
             listen_address <> '0.0.0.0'
             OR (protocol = 'http' AND listen_port <> 80)
             OR (protocol = 'https' AND listen_port <> 443)
           )`;

  await db.run(normalizeProxyRoutesStatement);
}
