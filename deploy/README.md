# Deployment — HTTPS is mandatory for the interview

## Why

The proctored interview (`/interview/:token`) uses the browser **camera and
microphone** via `navigator.mediaDevices.getUserMedia`. Browsers expose this API
**only in a secure context**: `https://` or `http://localhost`. This is a hard
W3C/browser rule — there is no application-level workaround (it is the same
reason Zoom and Google Meet on the web require HTTPS).

Consequences:

- On `http://localhost` (the dev machine itself) the camera works.
- On a **plain-HTTP network address** (`http://10.0.0.5`, `http://hire.lan`) the
  camera is **blocked** and `navigator.mediaDevices` is `undefined` — the page
  cannot even raise a permission prompt.
- Inside an **embedded app webview** (e.g. opening the link inside Microsoft
  Teams/Slack) `mediaDevices` is likewise stripped. Candidates must open the
  link in a **standalone Chrome/Edge/Firefox tab**.

Therefore every non-localhost deployment **must terminate TLS** in front of the
app.

## Production topology (single origin)

```
                 ┌──────────── HTTPS (443) ────────────┐
   Candidate ───►│  Reverse proxy (Caddy / nginx)       │
   browser       │  • TLS termination (real cert)       │
                 │  • serves SPA  (client/dist)          │
                 │  • /api/*      → 127.0.0.1:4000       │
                 │  • /socket.io/* (WS upgrade) → :4000  │
                 └───────────────────┬──────────────────┘
                                     ▼
                          Node API (Express + Socket.IO) :4000
                          ──► PostgreSQL  ──► Redis
```

The client is already written for a single origin (`api` baseURL `'/api'`,
socket `io('/')`), so **no client code changes are required** — only the proxy.

### Steps

1. Point DNS at the host; pick `hire.example.com`.
2. Build the SPA:  `npm run build`  → `client/dist`.
3. Run the API in production:
   `NODE_ENV=production PORT=4000 node server/dist/app.js`
   (set `CLIENT_URL=https://hire.example.com` so CORS matches the origin).
4. Put a reverse proxy in front:
   - **Caddy** (automatic Let's Encrypt): use [`Caddyfile`](./Caddyfile).
   - **nginx**: use [`nginx.conf`](./nginx.conf) with a certbot/PKI certificate.

Liveness/readiness probes for an orchestrator: `GET /api/health`, `GET /api/ready`.

## Dev / QA over HTTPS (test the camera from another machine)

To exercise the interview from a candidate laptop on the LAN without a full
deployment:

```bash
# one-time: generate a self-signed cert (already gitignored)
npm run certs:dev

# run the API as usual, then the client over HTTPS bound to all interfaces
npm run dev:server
npm run dev:client:https        # serves https://<your-LAN-ip>:5173
```

On the candidate machine, open `https://<your-LAN-ip>:5173/interview/<token>`
and accept the one-time self-signed-certificate warning. The context is now
secure, so the camera/mic permission prompt appears and proctoring works.
(Self-signed is fine for testing; use a real certificate for production.)
