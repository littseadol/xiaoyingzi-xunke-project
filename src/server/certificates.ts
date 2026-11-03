import forge from 'node-forge';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { randomBytes, X509Certificate } from 'node:crypto';

export function lanAddresses(): string[] {
  return [
    ...new Set(
      Object.values(networkInterfaces())
        .flatMap((items) => items ?? [])
        .filter((item) => item.family === 'IPv4' && !item.internal)
        .map((item) => item.address),
    ),
  ];
}

export function ensureCertificates(directory: string): {
  key: string;
  cert: string;
  caPath: string;
  fingerprint: string;
} {
  const certDirectory = join(directory, 'certificates');
  mkdirSync(certDirectory, { recursive: true });
  const caPath = join(certDirectory, 'xiaoyingzi-root.crt');
  const caKeyPath = join(certDirectory, 'root-key.pem');
  let authority: forge.pki.Certificate;
  let authorityKey: forge.pki.rsa.PrivateKey;
  if (existsSync(caPath) && existsSync(caKeyPath)) {
    authority = forge.pki.certificateFromPem(readFileSync(caPath, 'utf8'));
    authorityKey = forge.pki.privateKeyFromPem(readFileSync(caKeyPath, 'utf8'));
  } else {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    authorityKey = keys.privateKey;
    authority = forge.pki.createCertificate();
    authority.publicKey = keys.publicKey;
    authority.serialNumber = `01${randomBytes(15).toString('hex')}`;
    authority.validity.notBefore = new Date(Date.now() - 86400000);
    authority.validity.notAfter = new Date(Date.now() + 10 * 365 * 86400000);
    authority.setSubject([
      { name: 'commonName', value: `XiaoYingZi Local CA ${randomBytes(4).toString('hex')}` },
    ]);
    authority.setIssuer(authority.subject.attributes);
    authority.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true },
    ]);
    authority.sign(authorityKey, forge.md.sha256.create());
    writeFileSync(caPath, forge.pki.certificateToPem(authority));
    writeFileSync(caKeyPath, forge.pki.privateKeyToPem(authorityKey), { mode: 0o600 });
  }
  const addresses = ['127.0.0.1', '::1', ...lanAddresses()].sort();
  const certPath = join(certDirectory, 'server.pem');
  const keyPath = join(certDirectory, 'server-key.pem');
  const addressPath = join(certDirectory, 'addresses.json');
  const previousAddresses = existsSync(addressPath) ? readFileSync(addressPath, 'utf8') : '';
  const needsRenewal =
    !existsSync(certPath) ||
    !existsSync(keyPath) ||
    previousAddresses !== JSON.stringify(addresses) ||
    new Date(new X509Certificate(readFileSync(certPath)).validTo).getTime() <
      Date.now() + 30 * 86400000;
  if (needsRenewal) {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const certificate = forge.pki.createCertificate();
    certificate.publicKey = keys.publicKey;
    certificate.serialNumber = `01${randomBytes(15).toString('hex')}`;
    certificate.validity.notBefore = new Date(Date.now() - 86400000);
    certificate.validity.notAfter = new Date(Date.now() + 365 * 86400000);
    certificate.setSubject([{ name: 'commonName', value: 'localhost' }]);
    certificate.setIssuer(authority.subject.attributes);
    certificate.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [{ type: 2, value: 'localhost' }, ...addresses.map((ip) => ({ type: 7, ip }))],
      },
    ]);
    certificate.sign(authorityKey, forge.md.sha256.create());
    writeFileSync(certPath, forge.pki.certificateToPem(certificate));
    writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 });
    writeFileSync(addressPath, JSON.stringify(addresses));
  }
  const cert = readFileSync(certPath, 'utf8');
  return {
    key: readFileSync(keyPath, 'utf8'),
    cert,
    caPath,
    fingerprint: new X509Certificate(cert).fingerprint256.replaceAll(':', '').toLowerCase(),
  };
}
