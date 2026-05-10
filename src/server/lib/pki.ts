import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type DistinguishedName = {
  commonName: string;
  organization: string | null;
  organizationalUnit: string | null;
  country: string | null;
  state: string | null;
  locality: string | null;
  emailAddress: string | null;
};

type CaInput = {
  subject: DistinguishedName;
  validityDays: number;
  pathLength: number | null;
  issuer?: {
    certificatePem: string;
    privateKeyPem: string;
  } | null;
};

type ServerCertificateInput = {
  subject: DistinguishedName;
  validityDays: number;
  subjectAltNames: string[];
  issuer: {
    certificatePem: string;
    privateKeyPem: string;
  };
};

type GeneratedMaterial = {
  certificatePem: string;
  privateKeyPem: string;
  serialNumber: string;
  issuedAt: string;
  expiresAt: string;
};

type GeneratedServerMaterial = GeneratedMaterial & {
  chainPem: string;
};

export async function generateCertificateAuthority(input: CaInput): Promise<GeneratedMaterial> {
  return withWorkspace(async (workspace) => {
    const keyPath = path.join(workspace, "ca.key.pem");
    const certPath = path.join(workspace, "ca.cert.pem");
    const csrPath = path.join(workspace, "ca.csr.pem");
    const configPath = path.join(workspace, "openssl.cnf");

    await writeConfig(configPath, buildCaConfig(input.subject, input.pathLength));
    await openssl(["genrsa", "-out", keyPath, "4096"]);

    if (input.issuer) {
      const issuerCertPath = path.join(workspace, "issuer.cert.pem");
      const issuerKeyPath = path.join(workspace, "issuer.key.pem");
      await writeFile(issuerCertPath, input.issuer.certificatePem, "utf8");
      await writeFile(issuerKeyPath, input.issuer.privateKeyPem, "utf8");
      await openssl(["req", "-new", "-key", keyPath, "-out", csrPath, "-config", configPath]);
      await openssl([
        "x509",
        "-req",
        "-in",
        csrPath,
        "-CA",
        issuerCertPath,
        "-CAkey",
        issuerKeyPath,
        "-CAcreateserial",
        "-out",
        certPath,
        "-days",
        String(input.validityDays),
        "-sha256",
        "-extensions",
        "v3_ca",
        "-extfile",
        configPath
      ]);
    } else {
      await openssl([
        "req",
        "-x509",
        "-new",
        "-nodes",
        "-key",
        keyPath,
        "-sha256",
        "-days",
        String(input.validityDays),
        "-out",
        certPath,
        "-config",
        configPath,
        "-extensions",
        "v3_ca"
      ]);
    }

    return readMaterial(keyPath, certPath);
  });
}

export async function generateServerCertificate(input: ServerCertificateInput): Promise<GeneratedServerMaterial> {
  return withWorkspace(async (workspace) => {
    const keyPath = path.join(workspace, "server.key.pem");
    const certPath = path.join(workspace, "server.cert.pem");
    const csrPath = path.join(workspace, "server.csr.pem");
    const issuerCertPath = path.join(workspace, "issuer.cert.pem");
    const issuerKeyPath = path.join(workspace, "issuer.key.pem");
    const configPath = path.join(workspace, "openssl.cnf");

    await writeConfig(configPath, buildServerConfig(input.subject, input.subjectAltNames));
    await writeFile(issuerCertPath, input.issuer.certificatePem, "utf8");
    await writeFile(issuerKeyPath, input.issuer.privateKeyPem, "utf8");

    await openssl(["genrsa", "-out", keyPath, "2048"]);
    await openssl(["req", "-new", "-key", keyPath, "-out", csrPath, "-config", configPath]);
    await openssl([
      "x509",
      "-req",
      "-in",
      csrPath,
      "-CA",
      issuerCertPath,
      "-CAkey",
      issuerKeyPath,
      "-CAcreateserial",
      "-out",
      certPath,
      "-days",
      String(input.validityDays),
      "-sha256",
      "-extensions",
      "v3_server",
      "-extfile",
      configPath
    ]);

    const material = await readMaterial(keyPath, certPath);
    return {
      ...material,
      chainPem: `${material.certificatePem.trim()}\n${input.issuer.certificatePem.trim()}\n`
    };
  });
}

async function withWorkspace<T>(callback: (workspace: string) => Promise<T>) {
  const workspace = await mkdtemp(path.join(tmpdir(), "aegis-pki-"));
  try {
    return await callback(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function openssl(args: string[]) {
  await execFileAsync("openssl", args, {
    env: {
      ...process.env
    }
  });
}

async function writeConfig(filePath: string, contents: string) {
  await writeFile(filePath, contents, "utf8");
}

async function readMaterial(keyPath: string, certPath: string): Promise<GeneratedMaterial> {
  const [privateKeyPem, certificatePem] = await Promise.all([
    readFile(keyPath, "utf8"),
    readFile(certPath, "utf8")
  ]);
  const details = await describeCertificate(certPath);
  return {
    certificatePem,
    privateKeyPem,
    serialNumber: details.serialNumber,
    issuedAt: details.issuedAt,
    expiresAt: details.expiresAt
  };
}

async function describeCertificate(certPath: string) {
  const { stdout } = await execFileAsync("openssl", [
    "x509",
    "-in",
    certPath,
    "-noout",
    "-serial",
    "-startdate",
    "-enddate"
  ]);
  const lines = stdout.trim().split("\n");
  const serialNumber = lines.find((line) => line.startsWith("serial="))?.slice("serial=".length) ?? "";
  const issuedAtRaw = lines.find((line) => line.startsWith("notBefore="))?.slice("notBefore=".length) ?? "";
  const expiresAtRaw = lines.find((line) => line.startsWith("notAfter="))?.slice("notAfter=".length) ?? "";

  return {
    serialNumber,
    issuedAt: new Date(issuedAtRaw).toISOString(),
    expiresAt: new Date(expiresAtRaw).toISOString()
  };
}

function buildSubjectLines(subject: DistinguishedName) {
  return [
    `CN = ${escapeConfigValue(subject.commonName)}`,
    subject.organization ? `O = ${escapeConfigValue(subject.organization)}` : null,
    subject.organizationalUnit ? `OU = ${escapeConfigValue(subject.organizationalUnit)}` : null,
    subject.country ? `C = ${escapeConfigValue(subject.country)}` : null,
    subject.state ? `ST = ${escapeConfigValue(subject.state)}` : null,
    subject.locality ? `L = ${escapeConfigValue(subject.locality)}` : null,
    subject.emailAddress ? `emailAddress = ${escapeConfigValue(subject.emailAddress)}` : null
  ].filter(Boolean);
}

function buildCaConfig(subject: DistinguishedName, pathLength: number | null) {
  const pathLengthSuffix = pathLength == null ? "" : `,pathlen:${pathLength}`;
  return `
[ req ]
default_bits = 4096
prompt = no
distinguished_name = dn
x509_extensions = v3_ca

[ dn ]
${buildSubjectLines(subject).join("\n")}

[ v3_ca ]
basicConstraints = critical,CA:true${pathLengthSuffix}
keyUsage = critical,keyCertSign,cRLSign,digitalSignature
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
`.trim();
}

function buildServerConfig(subject: DistinguishedName, subjectAltNames: string[]) {
  const altNames = subjectAltNames.map((entry, index) => {
    const key = net.isIP(entry) ? "IP" : "DNS";
    return `${key}.${index + 1} = ${escapeConfigValue(entry)}`;
  });

  return `
[ req ]
default_bits = 2048
prompt = no
distinguished_name = dn
req_extensions = req_ext

[ dn ]
${buildSubjectLines(subject).join("\n")}

[ req_ext ]
subjectAltName = @alt_names

[ v3_server ]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer

[ alt_names ]
${altNames.join("\n")}
`.trim();
}

function escapeConfigValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, " ").trim();
}
