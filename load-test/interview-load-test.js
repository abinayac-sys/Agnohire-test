// AgnoHire — end-to-end interview load test (k6), multi-tenant capable
//
// setup() logs into EACH tenant admin you provide and provisions everything
// through the actual REST API (sector/domain, a question bank, a test job,
// N candidates, N interviews) — no direct DB access, so it exercises exactly
// the same code paths (RLS, entitlement checks, validation) a real recruiter
// would. Each interview's accessToken comes straight back in the create
// response, so no email/token-scraping step is needed.
//
// The default function then replays the real CANDIDATE flow (public,
// token-based, unauthenticated) for one interview per VU, drawing from ALL
// tenants' token pools combined — so tenants' candidates genuinely run
// concurrently against each other, which also exercises tenant isolation
// (each tenant's rate-limit bucket, RLS scope, and quota are independent).
//
// BASE_URL and the TENANTS array (email/password per tenant) are hardcoded
// below for quick local reruns — edit them directly in this file instead of
// passing -e flags. DO NOT commit this file with real credentials filled in.
//
// Usage — two tenants, 50 candidates each (100 VUs total):
//   k6 run -e CANDIDATES_PER_TENANT=50 interview-load-test.js
//
// Add more entries to the TENANTS array for more tenants.
//
// Env vars (still configurable per run — everything else is hardcoded above):
//   CANDIDATES_PER_TENANT optional, default 50. Applied to EACH tenant, not the total.
//   SUBMIT                optional, default "false". Set "true" to also call /submit, which triggers
//                         real AI evaluation (real OpenAI cost) for every candidate in every tenant —
//                         leave off for a pure throughput/rate-limit test.
//
// IMPORTANT: point BASE_URL at the public HTTPS domain, not http://localhost — hitting localhost
// skips both reverse-proxy hops (TLS + nginx) and doesn't exercise TRUST_PROXY_HOPS or the real
// rate-limiter bucketing, giving artificially optimistic numbers.
//
// IMPORTANT: this creates real Candidate/Interview/JobRequisition rows under EACH tenant whose
// credentials you provide, and consumes that tenant's plan quota (maxCandidates, maxActiveJobs,
// maxInterviewedCandidates on the SCHEDULED -> IN_PROGRESS transition) AND its staff-side API rate
// limit (rate_limit.max_requests — bulk-creating candidates one-by-one as a single admin user can
// trip this; check/raise it in System Configuration first if you hit 429s during setup).

import http from 'k6/http';
import { check, sleep, fail } from 'k6';

// Hardcoded for quick local reruns. DO NOT commit this file with real
// credentials filled in, and don't share it as-is — anyone with it has
// these tenants' admin logins.
const BASE_URL = "http://localhost:5173";
const TENANTS = [
  { label: 'tenant1', email: 'kishor@agnoshin.com', password: 'Admin@12345' },
  
];

const CANDIDATES_PER_TENANT = Number(__ENV.CANDIDATES_PER_TENANT || __ENV.CANDIDATES || 50);
const DO_SUBMIT = (__ENV.SUBMIT || 'false').toLowerCase() === 'true';

if (!BASE_URL) {
  throw new Error('Set BASE_URL at the top of the script.');
}
if (TENANTS.some((t) => !t.email || !t.password || t.email.startsWith('<'))) {
  throw new Error('Fill in real email/password for each entry in TENANTS at the top of the script.');
}

const API = `${BASE_URL.replace(/\/+$/, '')}/api`;
const TOTAL_VUS = TENANTS.length * CANDIDATES_PER_TENANT;

export const options = {
  scenarios: {
    interviews: {
      executor: 'per-vu-iterations',
      vus: TOTAL_VUS,
      iterations: 1,
      maxDuration: '30m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:answer}': ['p(95)<1000'],
  },
  setupTimeout: '10m',
};

function authHeaders(token) {
  return { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
}

function unwrap(res, label) {
  const ok = check(res, { [`${label} ok`]: (r) => r.status >= 200 && r.status < 300 });
  if (!ok) {
    fail(`${label} failed: ${res.status} ${res.body}`);
  }
  return res.json('data');
}

/** Provisions one tenant end-to-end and returns its pool of interview access tokens. */
function provisionTenant(tenant) {
  const p = tenant.label;

  const loginRes = http.post(
    `${API}/auth/dev-login`,
    JSON.stringify({ email: tenant.email, password: tenant.password }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const { accessToken } = unwrap(loginRes, `${p} login`);
  const auth = authHeaders(accessToken);

  let sectors = unwrap(http.get(`${API}/admin/sectors`, auth), `${p} list sectors`).sectors;
  let sector = sectors[0];
  if (!sector) {
    sector = unwrap(
      http.post(`${API}/admin/sectors`, JSON.stringify({ name: 'Load Test', type: 'General' }), auth),
      `${p} create sector`,
    ).sector;
  }

  let domains = unwrap(http.get(`${API}/admin/domains?sectorId=${sector.id}`, auth), `${p} list domains`).domains;
  let domain = domains[0];
  if (!domain) {
    domain = unwrap(
      http.post(`${API}/admin/domains`, JSON.stringify({ name: 'Load Test Domain', sectorId: sector.id }), auth),
      `${p} create domain`,
    ).domain;
  }

  const questions = Array.from({ length: 5 }, (_, i) => ({
    text: `Load test question ${i + 1}: describe your approach to a common problem in this domain.`,
    type: 'TEXT',
    difficulty: 'MEDIUM',
    tags: ['load-test'],
    orderIndex: i,
  }));
  const bank = unwrap(
    http.post(
      `${API}/question-banks`,
      JSON.stringify({ name: `Load Test Bank ${Date.now()}`, domainId: domain.id, isPublic: true, questions }),
      auth,
    ),
    `${p} create question bank`,
  ).bank;

  const job = unwrap(
    http.post(
      `${API}/jobs`,
      JSON.stringify({
        title: `Load Test Job ${Date.now()}`,
        description: 'Synthetic job requisition created for k6 load testing. Safe to delete.',
        sectorId: sector.id,
        domainId: domain.id,
        headcount: CANDIDATES_PER_TENANT,
      }),
      auth,
    ),
    `${p} create job`,
  ).job;

  const pool = [];
  for (let i = 0; i < CANDIDATES_PER_TENANT; i++) {
    const candidate = unwrap(
      http.post(
        `${API}/candidates`,
        JSON.stringify({
          fullName: `Load Test Candidate ${i + 1}`,
          email: `loadtest.${Date.now()}.${p}.${i}@example.invalid`,
          sectorId: sector.id,
          domainId: domain.id,
          jobRequisitionId: job.id,
        }),
        auth,
      ),
      `${p} create candidate ${i}`,
    ).candidate;

    const interview = unwrap(
      http.post(
        `${API}/interviews`,
        JSON.stringify({
          candidateId: candidate.id,
          questionBankId: bank.id,
          jobRequisitionId: job.id,
          durationMin: 60,
        }),
        auth,
      ),
      `${p} create interview ${i}`,
    ).interview;

    pool.push({ token: interview.accessToken, tenant: p });
  }

  console.log(`${p} setup complete: job=${job.id} bank=${bank.id} candidates=${pool.length}`);
  return { pool, questionCount: questions.length };
}

export function setup() {
  const results = TENANTS.map(provisionTenant);
  const pool = results.flatMap((r) => r.pool);
  console.log(`Total setup complete across ${TENANTS.length} tenant(s): ${pool.length} candidates`);
  return { pool, questionCount: results[0].questionCount };
}

export default function (data) {
  const item = data.pool[(__VU - 1) % data.pool.length];
  const token = item.token;
  const base = `${API}/interview/${token}`;
  const tenantTag = { tenant: item.tenant };

  // GET the interview (candidate opening the link) — this is where the question list comes from.
  const getRes = http.get(base, { tags: { name: 'get', ...tenantTag } });
  check(getRes, { 'get interview ok': (r) => r.status === 200 });
  const getData = getRes.json('data');
  const questions = (getData && getData.interview && getData.interview.questions) || [];

  // Start
  const startRes = http.post(`${base}/start`, null, { tags: { name: 'start', ...tenantTag } });
  const startOk = check(startRes, { 'start ok': (r) => r.status === 200 });
  if (!startOk) {
    console.error(`start failed for VU ${__VU} (${item.tenant}): ${startRes.status} ${startRes.body}`);
    return;
  }

  sleep(1);

  // Answer each question with a short think-time in between, like a real candidate typing.
  for (let i = 0; i < questions.length; i++) {
    const qid = questions[i] && questions[i].id;
    if (!qid) continue;
    const answerRes = http.post(
      `${base}/answer`,
      JSON.stringify({ questionId: qid, answerText: 'This is a synthetic load-test answer.' }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'answer', ...tenantTag } },
    );
    check(answerRes, { 'answer ok': (r) => r.status === 200 });
    sleep(Math.random() * 5 + 2);
  }

  if (DO_SUBMIT) {
    const submitRes = http.post(`${base}/submit`, null, { tags: { name: 'submit', ...tenantTag } });
    check(submitRes, { 'submit ok': (r) => r.status === 200 });
  }
}
