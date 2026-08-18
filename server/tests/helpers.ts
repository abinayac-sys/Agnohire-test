import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import supertest from 'supertest';
import { PrismaClient } from '@prisma/client';

// The suite no longer imports the app's config (which used to pull dotenv in as
// a side effect), so load the root .env here — DIRECT_URL below depends on it.
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

/** Base URL of the running server under test. */
export const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:4000';

/**
 * Fixture DB client for out-of-band setup/teardown and assertions.
 *
 * Deliberately NOT the app's client (src/config/database.ts): that one runs as
 * the restricted `agnohire_app` role and derives its tenant GUCs from the
 * request's AsyncLocalStorage context. A test process has no such context, so
 * RLS (enabled + FORCEd on every tenant table) would hide every row and reads
 * would silently come back empty.
 *
 * This connects via DIRECT_URL as the owner (superuser/BYPASSRLS), the same
 * connection migrations and the seed use, so fixtures can see and write across
 * tenants. The app's real RLS behaviour is still exercised end-to-end by the
 * HTTP-driven tests, which go through the server and its restricted role.
 */
export const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});

/** A Supertest agent bound to the live server. */
export const api = () => supertest(BASE_URL);

export interface DevUser {
  email: string;
  password: string;
}

export const ADMIN: DevUser = {
  email: 'admin@agnohire.local',
  password: 'Admin@12345',
};

/**
 * The sector-scoped recruiter fixture (Default sector). Used for cross-sector
 * isolation tests against the ZZQA candidates. Created out-of-band in the dev DB
 * (see project memory / leak-regression fixtures).
 */
export const SCOPED_RECRUITER: DevUser = {
  email: 'recruiter.qa@agnohire.local',
  password: 'Recruiter@12345',
};

/** Seeded candidate with a linked Candidate profile — drives the portal chatbot. */
export const CANDIDATE: DevUser = {
  email: 'candidate@agnohire.local',
  password: 'Candidate@12345',
};

/** Logs in via dev-login and returns the bearer access token. */
export async function login(user: DevUser = ADMIN): Promise<string> {
  const res = await api()
    .post('/api/auth/dev-login')
    .send(user)
    .set('Content-Type', 'application/json');
  if (res.status !== 200 || !res.body?.data?.accessToken) {
    throw new Error(
      `dev-login failed for ${user.email}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.accessToken as string;
}

/** A request with the Authorization header preset. */
export function authed(token: string) {
  return {
    get: (path: string) => api().get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string) => api().post(path).set('Authorization', `Bearer ${token}`),
    put: (path: string) => api().put(path).set('Authorization', `Bearer ${token}`),
    patch: (path: string) => api().patch(path).set('Authorization', `Bearer ${token}`),
    delete: (path: string) => api().delete(path).set('Authorization', `Bearer ${token}`),
  };
}

/** Whether the running server is reachable; tests can skip gracefully if not. */
export async function serverUp(): Promise<boolean> {
  try {
    const res = await api().get('/api/health');
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Creates a second Organization + Workspace under the caller's own tenant
 * (via the self-service management API, not a fixture insert), so isolation
 * tests exercise the exact same code path a real tenant admin would use.
 */
export async function createOrgAndWorkspace(
  token: string,
  label: string,
): Promise<{ organizationId: string; workspaceId: string }> {
  const orgRes = await authed(token).post('/api/organizations').send({ name: `${label} Org` });
  if (orgRes.status !== 201) {
    throw new Error(`create org failed: ${orgRes.status} ${JSON.stringify(orgRes.body)}`);
  }
  const organizationId = orgRes.body.data.organization.id as string;
  const wsRes = await authed(token)
    .post('/api/workspaces')
    .send({ name: `${label} Workspace`, organizationId });
  if (wsRes.status !== 201) {
    throw new Error(`create workspace failed: ${wsRes.status} ${JSON.stringify(wsRes.body)}`);
  }
  const workspaceId = wsRes.body.data.workspace.id as string;
  return { organizationId, workspaceId };
}

/** Switches the caller's ambient scope and returns the newly-issued access token. */
export async function switchToWorkspace(token: string, workspaceId: string): Promise<string> {
  const res = await authed(token).post('/api/auth/switch-workspace').send({ workspaceId });
  if (res.status !== 200) {
    throw new Error(`switch-workspace failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken as string;
}

/**
 * Creates a user with a narrow (non-admin-tier) global Role, scoped to
 * whatever Organization/Workspace the `adminToken` caller is CURRENTLY
 * resolved into (adminUserService grants membership there — see
 * ensureWorkspaceMembership) — never to a caller-specified org/workspace.
 */
export async function createRoleScopedUser(
  adminToken: string,
  roleName: string,
  user: DevUser,
): Promise<string> {
  const roles = await authed(adminToken).get('/api/admin/roles');
  const roleId = (roles.body?.data?.roles ?? []).find((r: { name: string }) => r.name === roleName)?.id;
  if (!roleId) throw new Error(`role ${roleName} not found`);
  const res = await authed(adminToken)
    .post('/api/admin/users')
    .send({ fullName: `Test ${roleName} ${Date.now().toString(36)}`, email: user.email, roleId, phone: '+15550100999', password: user.password });
  if (res.status !== 201) {
    throw new Error(`create user failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.user.id as string;
}
