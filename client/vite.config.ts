import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// vite.config.ts runs in plain Node, not through the `dotenv -e ../.env --`
// wrapper the server scripts use — nothing loads the repo-root .env into
// process.env otherwise. Without this, `process.env.PORT` below is always
// undefined regardless of what a developer set PORT to, silently falling
// back to 4000 and proxying every /api request to the wrong port whenever
// the server actually runs elsewhere.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// HTTPS for the dev/staging server. Browser camera/microphone access
// (getUserMedia, required by the proctored interview) only works in a SECURE
// CONTEXT — i.e. https:// or http://localhost. To exercise the interview from
// another machine (a candidate laptop, a QA device) you MUST serve over HTTPS.
//
// Opt in with HTTPS=true and point at a cert/key (defaults to client/certs/).
// Generate a self-signed pair once:
//   openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
//     -keyout client/certs/key.pem -out client/certs/cert.pem \
//     -subj "/CN=localhost" \
//     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
// For production, terminate TLS at the reverse proxy instead (see deploy/).
const httpsEnabled = process.env.HTTPS === 'true';
const certPath = process.env.SSL_CERT ?? path.resolve(__dirname, 'certs/cert.pem');
const keyPath = process.env.SSL_KEY ?? path.resolve(__dirname, 'certs/key.pem');

function resolveHttps() {
  if (!httpsEnabled) return undefined;
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    throw new Error(
      `HTTPS=true but no certificate found at ${certPath} / ${keyPath}. ` +
        'Generate one (see vite.config.ts) or set SSL_CERT / SSL_KEY.',
    );
  }
  return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
}

// Backend port — must match the server's own PORT (.env), not be assumed.
// Hardcoding this to the 4000 default silently 502s every /api request
// whenever a developer's server runs on a different port (e.g. 4000 was
// already taken locally and they set PORT=4001) — the proxy target and the
// server it's proxying to drift apart with zero error until someone notices
// every request is a Bad Gateway.
const backendPort = process.env.PORT ?? '4000';

// LiveKit's HTTP/WS port (server/src/config/env.ts default). Proxying it
// through Vite's own origin — same trick as /api and /socket.io below — means
// a browser only ever needs to trust ONE certificate (this dev server's) to
// make WebRTC calls work, instead of also having to separately visit and
// accept the warning for LiveKit's own host:port. See getLiveKitToken in
// communication.controller.ts, which mirrors the browser's own origin back
// so the LiveKit SDK connects to (this same host):(this same port)/rtc.
const livekitUrl = new URL(process.env.LIVEKIT_URL ?? 'http://localhost:7880');

// Shared by both `server` (dev) and `preview` (local production-build
// verification) — without it, `vite preview` has no path to the backend at
// all, which is why testing a real production build locally never worked.
const backendProxy: Record<string, import('vite').ProxyOptions> = {
  '/rtc': {
    target: livekitUrl.origin,
    ws: true,
    changeOrigin: true,
  },
  '/api': {
    target: `http://localhost:${backendPort}`,
    changeOrigin: true,
    configure: (proxy) => {
      const originalEmit = proxy.emit;
      proxy.emit = function (event: string, ...args: any[]) {
        if (event === 'error') {
          const err = args[0] as any;
          const res = args[2] as any;
          if (err?.code === 'ECONNREFUSED' || err?.code === 'ECONNRESET') {
            if (res && typeof res.writeHead === 'function' && !res.headersSent) {
              res.writeHead(502);
              res.end('Bad Gateway');
            }
            return false; // Suppress
          }
        }
        return originalEmit.apply(this, [event, ...args]);
      };
    },
  },
  '/socket.io': {
    target: `http://localhost:${backendPort}`,
    ws: true,
    configure: (proxy) => {
      const originalEmit = proxy.emit;
      proxy.emit = function (event: string, ...args: any[]) {
        if (event === 'error') {
          const err = args[0] as any;
          const res = args[2] as any;
          const code = err?.code;
          const msg = err?.message || '';
          if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET')) {
            if (res && typeof res.writeHead === 'function' && !res.headersSent) {
              res.writeHead(502);
              res.end('Bad Gateway');
            }
            return false; // Suppress
          }
        }
        return originalEmit.apply(this, [event, ...args]);
      };
    },
  },
  '/uploads': {
    target: `http://localhost:${backendPort}`,
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@agnohire/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
    // Bind all interfaces only when serving HTTPS, so the secure interview page
    // is reachable from other machines on the network. Plain-HTTP LAN access is
    // intentionally left bound to localhost (camera would be blocked anyway).
    host: httpsEnabled ? true : '0.0.0.0',
    https: resolveHttps(),
    // Proxy API + socket to the backend during dev.
    proxy: backendProxy,
    // Native OS file-watch handles (ReadDirectoryChangesW on Windows) can go
    // silently stale on a long-running dev server — no error, no crash, HMR
    // just stops picking up new edits until the browser is hard-refreshed.
    // Polling re-reads file state on an interval instead of relying on a
    // long-lived OS subscription, so it keeps working no matter how long
    // `npm run dev` has been up.
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
  preview: {
    port: 4173,
    proxy: backendProxy,
  },
});
