import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

import { createDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { DnsRuntimeManager } from "./dns/runtime-manager.js";
import { EventBus } from "./events/event-bus.js";
import { AppError } from "./lib/app-error.js";
import { env, isProduction } from "./lib/env.js";
import { createAuthMiddleware } from "./lib/auth-middleware.js";
import { createPrivilegedPortError, getPrivilegedPortListeners, hasPrivilegedPortAccess } from "./lib/privileged-ports.js";
import { ProxyRuntimeManager } from "./proxy/runtime-manager.js";
import { createRepositories } from "./repositories/index.js";
import { createAcmeRouter } from "./routes/acme.js";
import { createEventsRouter } from "./routes/events.js";
import { createConfigRouter } from "./routes/config.js";
import { createApiKeyRouter } from "./routes/api-keys.js";
import { createAuthRouter } from "./routes/auth.js";
import { createCertificateRouter } from "./routes/certificates.js";
import { createCloudflareRouter } from "./routes/cloudflare.js";
import { createDnsRouter } from "./routes/dns.js";
import { createDockerRouter } from "./routes/docker.js";
import { createNetworkInterfacesRouter } from "./routes/network-interfaces.js";
import { createProxyRouter } from "./routes/proxy.js";
import { AcmeService } from "./services/acme-service.js";
import { CertificateRenewalService } from "./services/certificate-renewal-service.js";
import { CertificateService } from "./services/certificate-service.js";
import { DnsService } from "./services/dns-service.js";
import { DockerService } from "./services/docker-service.js";
import { NetworkInterfaceService } from "./services/network-interface-service.js";
import { ProxyHealthChecker } from "./services/proxy-health-checker.js";
import { ProxyService } from "./services/proxy-service.js";
import { WsGateway } from "./ws/gateway.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, "../../src/client/dist");

async function verifyPrivilegedPortAccess(repositories: ReturnType<typeof createRepositories>) {
  const [resolverSettings, proxyRoutes] = await Promise.all([
    repositories.resolverSettings.get(),
    repositories.proxyRoutes.listEnabled()
  ]);
  const listeners = getPrivilegedPortListeners({
    resolverSettings,
    proxyRoutes
  });
  if (listeners.length > 0 && !hasPrivilegedPortAccess()) {
    throw createPrivilegedPortError(listeners);
  }
}

async function bootstrap() {
  const app = express();
  const db = createDb();
  await migrate(db);
  const repositories = createRepositories(db);
  await verifyPrivilegedPortAccess(repositories);
  const gateway = new WsGateway();
  const eventBus = new EventBus(repositories, gateway);
  const dnsWorkerFile = import.meta.url.endsWith(".ts") ? "runtime-worker-bootstrap.mjs" : "runtime-worker.js";
  const proxyWorkerFile = import.meta.url.endsWith(".ts") ? "runtime-worker-bootstrap.mjs" : "runtime-worker.js";
  const dnsRuntimeManager = new DnsRuntimeManager(
    repositories,
    eventBus,
    new URL(`./dns/${dnsWorkerFile}`, import.meta.url),
    gateway
  );
  const proxyRuntimeManager = new ProxyRuntimeManager(
    repositories,
    eventBus,
    new URL(`./proxy/${proxyWorkerFile}`, import.meta.url),
    gateway
  );
  dnsRuntimeManager.start();
  proxyRuntimeManager.start();
  const certificateService = new CertificateService(repositories, eventBus);
  const acmeService = new AcmeService(repositories, eventBus, gateway);
  const dockerService = new DockerService(repositories, eventBus, proxyRuntimeManager, dnsRuntimeManager);
  dockerService.startWatching();
  const dnsService = new DnsService(repositories, eventBus, dnsRuntimeManager);
  const networkInterfaceService = new NetworkInterfaceService(repositories);
  const proxyService = new ProxyService(repositories, eventBus, proxyRuntimeManager);
  const proxyHealthChecker = new ProxyHealthChecker(repositories, gateway);
  proxyHealthChecker.start();
  const renewalService = new CertificateRenewalService(repositories, certificateService, acmeService, proxyRuntimeManager, gateway);
  renewalService.start();

  app.use(cors({
    origin: isProduction ? env.appUrl : true
  }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, environment: env.nodeEnv, database: db.driver });
  });

  // Public auth routes (no JWT required)
  app.use("/api/auth", createAuthRouter(repositories));

  // All other /api/* routes require authentication (JWT or API key)
  app.use("/api", createAuthMiddleware(repositories));

  app.use("/api/config", createConfigRouter(repositories));
  app.use("/api/api-keys", createApiKeyRouter(repositories));
  app.use("/api/cloudflare", createCloudflareRouter(repositories));
  app.use("/api/acme", createAcmeRouter(acmeService));
  app.use("/api/events", createEventsRouter(repositories));
  app.use("/api/certificates", createCertificateRouter(certificateService));
  app.use("/api/dns", createDnsRouter(dnsService));
  app.use("/api/docker", createDockerRouter(dockerService));
  app.use("/api/network-interfaces", createNetworkInterfacesRouter(networkInterfaceService));
  app.use("/api/proxy", createProxyRouter(proxyService));

  app.use(express.static(clientDist));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (error instanceof ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.flatten() });
    }
    console.error("Unhandled error:", error);
    return res.status(500).json({ error: "Internal server error" });
  };
  app.use(errorHandler);

  const server = http.createServer(app);
  gateway.attach(server);

  server.listen(env.port, () => {
    console.log(`Aegis listening on ${env.appUrl}`);
  });

  const shutdown = async () => {
    proxyHealthChecker.stop();
    renewalService.stop();
    await Promise.all([dnsRuntimeManager.stop(), proxyRuntimeManager.stop()]);
    server.close();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
