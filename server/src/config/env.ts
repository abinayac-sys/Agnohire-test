import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load the repo-root .env (server runs from /server).
// `override: true` is required here: dotenv's default is to skip any key
// that already exists in process.env — including one the host platform
// predefined as an empty placeholder (e.g. a blank RAZORPAY_KEY_ID from a
// systemd unit / process manager template). Without override, filling in
// the real value in .env would silently be ignored and the var would stay
// blank for the life of the process, exactly the "I configured it but it's
// still missing" symptom.
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: true });
dotenv.config({ override: true }); // also pick up a local server/.env if present

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  isProd: process.env.NODE_ENV === 'production',
  port: Number(optional('PORT', '4000')),
  clientUrl: optional('CLIENT_URL', 'http://localhost:5173'),
  // Number of reverse-proxy hops in front of this process (e.g. host nginx +
  // the "web" container's nginx = 2). Must match the real topology exactly —
  // too low collapses all clients' req.ip into a shared proxy address (false
  // rate-limit hits); too high lets a client's own spoofed X-Forwarded-For
  // entries be trusted as req.ip. See middlewares/rateLimiter.middleware.ts.
  trustProxyHops: Number(optional('TRUST_PROXY_HOPS', '1')),

  // Root domain for tenant subdomain routing (e.g. `agnohire.com` →
  // `acme.agnohire.com`). Empty disables host-based tenant resolution, leaving
  // JWT-only isolation exactly as before. Requires wildcard DNS + TLS in infra.
  rootDomain: optional('APP_ROOT_DOMAIN', ''),

  databaseUrl: required('DATABASE_URL'),
  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),

  // Self-hosted Piston code execution engine, backing candidate "Run Code" /
  // test-case grading for CODE questions. Empty URL = execution disabled.
  piston: {
    url: optional('PISTON_URL', ''),
    timeoutSeconds: Number(optional('PISTON_TIMEOUT_SECONDS', '10')),
    get enabled() {
      return Boolean(this.url);
    },
  },

  jwtSecret: required('JWT_SECRET'),
  sessionSecret: optional('SESSION_SECRET', required('JWT_SECRET')),
  encryptionKey: required('ENCRYPTION_KEY'),

  // Platform-level Razorpay operator keys (one account for the whole SaaS).
  // Never stored per-tenant. keyId is safe to expose to the client (Checkout).
  razorpay: {
    keyId: optional('RAZORPAY_KEY_ID'),
    keySecret: optional('RAZORPAY_KEY_SECRET'),
    webhookSecret: optional('RAZORPAY_WEBHOOK_SECRET'),
    get enabled() {
      return Boolean(this.keyId && this.keySecret);
    },
  },

  google: {
    clientId: optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  // Microsoft Calendar/Teams: only the OAuth redirect URI is global deployment
  // config (AgnoHire's own callback endpoint, same for every workspace — each
  // superadmin registers this exact URL on their own Entra app). Client
  // id/secret/tenant id are NOT here — those are per-workspace data stored in
  // each sector's Integration row (Integration.configJson, type
  // 'MICROSOFT_CALENDAR'), same pattern as Google's Calendar clientId/secret.
  microsoftRedirectUri: optional('MICROSOFT_REDIRECT_URI', ''),

  // LiveKit — powers the team communication module's WebRTC calling (see
  // server/src/controllers/communication.controller.ts's getLiveKitToken).
  livekit: {
    // Used server-side (RoomServiceClient/AccessToken calls) — always local,
    // never needs TLS since it never leaves this machine.
    url: optional('LIVEKIT_URL', 'http://localhost:7880'),
    // Fallback only, used when a token request has neither an Origin nor a
    // Referer header to mirror back (see resolvePublicLiveKitUrl in
    // communication.controller.ts, which normally derives the browser-facing
    // URL from the request itself so it's always same-origin with the app).
    publicUrl: optional('LIVEKIT_PUBLIC_URL', ''),
    apiKey: optional('LIVEKIT_API_KEY', 'devkey'),
    apiSecret: optional('LIVEKIT_API_SECRET', 'secret'),
    get enabled() {
      return Boolean(this.url && this.apiKey && this.apiSecret);
    },
  },
} as const;

/** Dev email/password login is allowed only when Google OAuth is unconfigured and not in production. */
export const devLoginEnabled = !env.isProd && !env.google.enabled;

/**
 * SaaS password login: self-registered tenants have no Google OAuth, so
 * email/password is a first-class production path when ALLOW_PASSWORD_LOGIN=true
 * (recommended for the cloud deployment). Falls back to the legacy dev gate.
 */
export const passwordLoginEnabled =
  process.env.ALLOW_PASSWORD_LOGIN === 'true' || devLoginEnabled;
