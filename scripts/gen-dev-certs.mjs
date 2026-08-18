// Generate a self-signed TLS cert for the HTTPS dev server (client/certs/).
// The interview camera/mic (getUserMedia) only works in a secure context, so
// testing from another machine on the LAN needs HTTPS. Self-signed is fine for
// dev/QA — use a real certificate (reverse proxy) in production. See deploy/.
import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/certs');
mkdirSync(dir, { recursive: true });
const keyPath = path.join(dir, 'key.pem');
const certPath = path.join(dir, 'cert.pem');

if (existsSync(keyPath) && existsSync(certPath)) {
  console.log('Dev certs already exist at client/certs/ — nothing to do.');
  process.exit(0);
}

try {
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
      '-keyout', keyPath, '-out', certPath,
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    // MSYS_NO_PATHCONV stops Git Bash on Windows from mangling the -subj value.
    { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  );
  console.log('Generated self-signed dev certs at client/certs/.');
  console.log('Start the secure dev server with:  npm run dev:https');
} catch {
  console.error('Failed to generate certs — is `openssl` installed and on PATH?');
  console.error('Alternatively create client/certs/{cert.pem,key.pem} yourself, or set SSL_CERT/SSL_KEY.');
  process.exit(1);
}
