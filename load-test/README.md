# AgnoHire load testing (k6)

`interview-load-test.js` provisions test data through the real REST API (as
one or more real tenant admins) and then replays the real candidate
interview flow for however many candidates per tenant you specify — across
all tenants concurrently.

## Prerequisites

- k6 installed locally (`winget install k6 --source winget`).
- Real tenant admin (or owner) login credentials for each tenant you want to test.
- Run this from a machine that is **not** the production server itself, against
  the **public HTTPS domain** — not `localhost` (see the script's header comment
  for why: it skips TLS/nginx/rate-limiting entirely and gives misleading numbers).

## What it does

For each tenant you provide credentials for:
1. Logs in as that tenant's admin.
2. Reuses (or creates) a sector + domain.
3. Creates a small question bank (5 text questions).
4. Creates a throwaway job requisition.
5. Creates N candidates and N interviews, capturing each interview's access
   token directly from the API response (no email involved).

Then, across **all** tenants' candidates combined, runs one simulated
candidate per virtual user, all concurrently: open the interview link →
start → answer each question with a few seconds of "think time" between
answers → optionally submit. Running multiple tenants together also
exercises tenant isolation itself — each tenant has its own rate-limit
bucket, RLS scope, and plan quota, so this is a real test of whether one
tenant's load affects another's.

## Run it

**Single tenant** (`TENANT1_*` still works exactly like the old `ADMIN_*` vars did):
```bash
k6 run \
  -e BASE_URL=https://agnohire.agnocon.com \
  -e TENANT1_EMAIL=admin@yourcompany.com \
  -e TENANT1_PASSWORD='yourpassword' \
  -e CANDIDATES_PER_TENANT=100 \
  load-test/interview-load-test.js
```

**Two tenants, 50 candidates each** (100 VUs total, running concurrently):
```bash
k6 run \
  -e BASE_URL=https://agnohire.agnocon.com \
  -e TENANT1_EMAIL=owner1@company-a.com -e TENANT1_PASSWORD='secret1' \
  -e TENANT2_EMAIL=owner2@company-b.com -e TENANT2_PASSWORD='secret2' \
  -e CANDIDATES_PER_TENANT=50 \
  load-test/interview-load-test.js
```

Add `TENANT3_EMAIL`/`TENANT3_PASSWORD`, `TENANT4_...`, etc. for more tenants —
the script auto-detects however many `TENANT<N>_EMAIL`/`PASSWORD` pairs you set.

Optional env vars:
- `CANDIDATES_PER_TENANT` — candidates/interviews per tenant, default 50 (applied per tenant, not as a total).
- `SUBMIT` — set to `true` to also call `/submit` on every interview across every tenant, which
  triggers real AI evaluation (real OpenAI API cost) per candidate. Leave
  unset/`false` to test pure throughput/rate-limiting without that cost.

## Before you run this

- **Quota, per tenant**: this consumes each tenant's real plan quota (candidates, active
  jobs, and — once an interview transitions to `IN_PROGRESS` — interviewed
  candidates). If a tenant isn't on an unlimited/Enterprise plan, check its
  limits first, or that tenant's part of the run will fail partway with 402s
  that aren't a real bug.
- **Staff-side rate limit, per tenant**: provisioning N candidates one-by-one runs as a single
  admin user per tenant, hitting that tenant's `rate_limit.max_requests` bucket. If you see
  429s during setup, check/temporarily raise "Max requests per window" in that tenant's
  System Configuration.
- **Cleanup**: the job, candidates, and interviews created are real records —
  named `Load Test Job ...` / `Load Test Candidate N` so they're easy to find
  and delete afterward from each tenant's admin console.
- **Timing**: run during low-traffic hours the first time, and watch
  `docker stats` on the server alongside the test.
