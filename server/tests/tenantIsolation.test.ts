import { describe, it, expect, beforeAll } from 'vitest';
import { api, authed, login, ADMIN } from './helpers.js';

/**
 * Two-tenant isolation proof (black-box against the running server, like the
 * rest of this suite). Registers two FREE tenants, has a superadmin approve
 * them (self-registered tenants land PENDING and cannot sign in until
 * marketing approves — approval is also what starts the FREE trial and creates
 * the Subscription), logs both owners in, and asserts tenant B can never see
 * tenant A's data, and that quota metering is exposed per tenant.
 */

const run = Date.now().toString(36);
const OWNER_A = { email: `owner.a.${run}@isolation.test`, password: 'Tenant@12345A' };
const OWNER_B = { email: `owner.b.${run}@isolation.test`, password: 'Tenant@12345B' };

async function registerTenant(companyName: string, owner: { email: string; password: string }) {
  const res = await api()
    .post('/api/auth/register')
    .send({
      companyName,
      fullName: `Owner of ${companyName}`,
      email: owner.email,
      password: owner.password,
      // Required: marketing phone-qualifies every tenant before approving it.
      phone: '+15550100999',
      planCode: 'FREE',
      billingInterval: 'monthly',
    })
    .set('Content-Type', 'application/json');
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body.data.requiresPayment).toBe(false);
  return res.body.data.tenantId as string;
}

describe('tenant isolation', () => {
  let tokenA: string;
  let tokenB: string;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    tenantA = await registerTenant(`IsoTest A ${run}`, OWNER_A);
    tenantB = await registerTenant(`IsoTest B ${run}`, OWNER_B);

    // A self-registered tenant is inert until a superadmin approves it: the
    // owner cannot sign in, and the FREE-plan Subscription does not exist yet.
    const platformToken = await login(ADMIN);
    for (const id of [tenantA, tenantB]) {
      const res = await authed(platformToken)
        .post(`/api/platform/tenants/${id}/approve`)
        .send({ notes: 'tenant-isolation suite' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }

    tokenA = await login(OWNER_A);
    tokenB = await login(OWNER_B);
  });

  it('provisions two distinct tenants', () => {
    expect(tenantA).toBeTruthy();
    expect(tenantB).toBeTruthy();
    expect(tenantA).not.toBe(tenantB);
  });

  it('scopes usage reporting to the caller tenant', async () => {
    const a = await authed(tokenA).get('/api/tenant/usage');
    const b = await authed(tokenB).get('/api/tenant/usage');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.tenantId).toBe(tenantA);
    expect(b.body.data.tenantId).toBe(tenantB);
    expect(a.body.data.planCode).toBe('FREE');
  });

  it('tenant B cannot see tenant A users', async () => {
    const a = await authed(tokenA).get('/api/admin/users?page=1&pageSize=100');
    const b = await authed(tokenB).get('/api/admin/users?page=1&pageSize=100');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const emailsSeenByB = JSON.stringify(b.body);
    expect(emailsSeenByB).not.toContain(OWNER_A.email);
    const emailsSeenByA = JSON.stringify(a.body);
    expect(emailsSeenByA).not.toContain(OWNER_B.email);
  });

  it('tenant B cannot see tenant A candidates or jobs', async () => {
    for (const path of ['/api/candidates?page=1&pageSize=50', '/api/jobs?page=1&pageSize=50']) {
      const resB = await authed(tokenB).get(path);
      expect(resB.status).toBe(200);
      // Fresh tenant B must see an empty list even though tenant A (and the
      // legacy default tenant) have data in the same database.
      const items = resB.body?.data?.items ?? resB.body?.data ?? [];
      expect(Array.isArray(items) ? items.length : 0).toBe(0);
    }
  });

  it('subscription overview is tenant-scoped and FREE-plan limited', async () => {
    const b = await authed(tokenB).get('/api/billing/subscription');
    expect(b.status).toBe(200);
    expect(b.body.data.subscription.plan.code).toBe('FREE');
    const users = b.body.data.usage.usage.find((u: { metric: string }) => u.metric === 'USERS');
    expect(users.limit).not.toBeNull();
  });
});
