import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";

import { createDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { DnsRuntimeManager } from "./dns/runtime-manager.js";
import { EventBus } from "./events/event-bus.js";
import { env } from "./lib/env.js";
import { createPrivilegedPortError, getPrivilegedPortListeners, hasPrivilegedPortAccess } from "./lib/privileged-ports.js";
import { ProxyRuntimeManager } from "./proxy/runtime-manager.js";
import { createRepositories } from "./repositories/index.js";
import { createCertificateRouter } from "./routes/certificates.js";
import { createDnsRouter } from "./routes/dns.js";
import { createDockerRouter } from "./routes/docker.js";
import { createNetworkInterfacesRouter } from "./routes/network-interfaces.js";
import { createProxyRouter } from "./routes/proxy.js";
import { CertificateService } from "./services/certificate-service.js";
import { DnsService } from "./services/dns-service.js";
import { DockerService } from "./services/docker-service.js";
import { NetworkInterfaceService } from "./services/network-interface-service.js";
import { ProxyService } from "./services/proxy-service.js";

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
  const eventBus = new EventBus(repositories);
  const dnsWorkerFile = import.meta.url.endsWith(".ts") ? "runtime-worker-bootstrap.mjs" : "runtime-worker.js";
  const proxyWorkerFile = import.meta.url.endsWith(".ts") ? "runtime-worker-bootstrap.mjs" : "runtime-worker.js";
  const dnsRuntimeManager = new DnsRuntimeManager(
    repositories,
    eventBus,
    new URL(`./dns/${dnsWorkerFile}`, import.meta.url)
  );
  const proxyRuntimeManager = new ProxyRuntimeManager(
    repositories,
    eventBus,
    new URL(`./proxy/${proxyWorkerFile}`, import.meta.url)
  );
  dnsRuntimeManager.start();
  proxyRuntimeManager.start();
  const certificateService = new CertificateService(repositories, eventBus);
  const dockerService = new DockerService(repositories, eventBus, proxyRuntimeManager, dnsRuntimeManager);
  dockerService.startWatching();
  const dnsService = new DnsService(repositories, eventBus, dnsRuntimeManager);
  const networkInterfaceService = new NetworkInterfaceService(repositories);
  const proxyService = new ProxyService(repositories, eventBus, proxyRuntimeManager);

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      environment: env.nodeEnv,
      database: db.driver
    });
  });

  app.use("/api/certificates", createCertificateRouter(certificateService));
  app.use("/api/dns", createDnsRouter(dnsService));
  app.use("/api/docker", createDockerRouter(dockerService));
  app.use("/api/network-interfaces", createNetworkInterfacesRouter(networkInterfaceService));
  app.use("/api/proxy", createProxyRouter(proxyService));

  app.use(express.static(clientDist));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  app.listen(env.port, () => {
    console.log(`Aegis listening on ${env.appUrl}`);
  });

  const shutdown = async () => {
    await Promise.all([dnsRuntimeManager.stop(), proxyRuntimeManager.stop()]);
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
