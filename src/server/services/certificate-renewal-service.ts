import type { Repositories } from "../repositories/index.js";
import type { AuditContext } from "../types.js";
import type { WsGateway } from "../ws/gateway.js";
import type { AcmeService } from "./acme-service.js";
import type { CertificateService } from "./certificate-service.js";
import type { ProxyRuntimeManager } from "../proxy/runtime-manager.js";

const INTERVAL_MS = 60 * 60_000; // 1 hour

const systemContext: AuditContext = {
  actorType: "system",
  actorId: "certificate-renewal-service",
  sourceIp: null,
  userAgent: "aegis-certificate-renewal-service"
};

export class CertificateRenewalService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repositories: Repositories,
    private readonly certificateService: CertificateService,
    private readonly acmeService: AcmeService,
    private readonly proxyRuntimeManager: ProxyRuntimeManager,
    private readonly gateway: WsGateway
  ) {}

  start() {
    this.runCheck().catch(console.error);
    this.timer = setInterval(() => { this.runCheck().catch(console.error); }, INTERVAL_MS);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async runCheck() {
    const now = Date.now();
    const [internalCerts, acmeCerts] = await Promise.all([
      this.repositories.serverCertificates.list(),
      this.repositories.acmeCertificates.list()
    ]);

    const renewInternal = internalCerts
      .filter((c) => c.active && Math.ceil((new Date(c.expiresAt).getTime() - now) / 86400_000) <= c.renewalDays)
      .map(async (cert) => {
        try {
          const oldPem = cert.certificatePem;
          const renewed = await this.certificateService.renewServerCertificate(cert.id, systemContext);
          if (renewed && renewed.certificatePem !== oldPem) {
            await this.repositories.proxyRoutes.updateTlsCert(oldPem, renewed.certificatePem, renewed.privateKeyPem);
            console.log(`Renewed internal cert ${cert.name} (expires ${cert.expiresAt})`);
            return true;
          }
        } catch (err) {
          console.error(`Failed to renew internal cert ${cert.id}:`, err);
        }
        return false;
      });

    const renewAcme = acmeCerts
      .filter((c) => c.active && Math.ceil((new Date(c.expiresAt).getTime() - now) / 86400_000) <= c.renewalDays)
      .map(async (cert) => {
        try {
          const oldPem = cert.certificatePem;
          const renewed = await this.acmeService.renewCertificate(cert.id, systemContext);
          if (renewed && renewed.certificatePem !== oldPem) {
            await this.repositories.proxyRoutes.updateTlsCert(oldPem, renewed.certificatePem, renewed.privateKeyPem);
            console.log(`Renewed ACME cert ${cert.name} (expires ${cert.expiresAt})`);
            return true;
          }
        } catch (err) {
          console.error(`Failed to renew ACME cert ${cert.id}:`, err);
        }
        return false;
      });

    const results = await Promise.all([...renewInternal, ...renewAcme]);
    if (results.some(Boolean)) {
      this.proxyRuntimeManager.requestReload();
      this.gateway.broadcast(["server-certificates", "acme-certificates", "proxy-routes"]);
    }
  }
}
