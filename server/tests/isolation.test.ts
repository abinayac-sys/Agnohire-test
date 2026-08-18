import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { authed, login, ADMIN, SCOPED_RECRUITER, serverUp } from './helpers.js';

const VIS_KEY = 'security.cross_sector_visibility';

/**
 * Cross-sector data-isolation regression. Guards the OR-collision / fail-closed
 * scoping fixes: a sector-scoped recruiter (Default) must never see another
 * sector's candidates, via either the list or the search path.
 *
 * Relies on the live leak-regression fixtures:
 *   - ZZQA Alpha Default  (Default sector)  → recruiter SHOULD see
 *   - ZZQA Bravo SectorB  (QA Sector B)     → recruiter must NOT see
 * If the recruiter fixture is absent the test self-skips.
 */
describe('Cross-sector isolation', () => {
  let up = false;
  let adminToken = '';
  let recruiterToken: string | null = null;
  let priorVisibility: string | null = null;

  beforeAll(async () => {
    up = await serverUp();
    if (!up) return;
    adminToken = await login(ADMIN);
    try {
      recruiterToken = await login(SCOPED_RECRUITER);
    } catch {
      recruiterToken = null; // fixture not present in this DB
    }
    // These tests assert strict per-sector isolation, so force the
    // cross-sector-visibility flag OFF regardless of the ambient (e.g. demo)
    // setting, remembering the prior value to restore afterwards.
    const cfg = await authed(adminToken).get('/api/system/config');
    const rows = (cfg.body?.data?.config ?? []) as Array<{ key: string; value: string }>;
    priorVisibility = rows.find((r) => r.key === VIS_KEY)?.value ?? null;
    await authed(adminToken).put(`/api/system/config/${VIS_KEY}`).send({ value: 'false' });
  });

  afterAll(async () => {
    if (!up || priorVisibility === null) return;
    // Restore whatever the deployment had configured (e.g. 'true' for a demo).
    await authed(adminToken).put(`/api/system/config/${VIS_KEY}`).send({ value: priorVisibility });
  });

  const names = (body: any): string[] =>
    (body?.data?.items ?? []).map((c: any) => c.fullName as string);

  it('control: admin sees both sectors', async () => {
    if (!up) return;
    const res = await authed(adminToken).get('/api/candidates?search=ZZQA&limit=20');
    expect(res.status).toBe(200);
    const found = names(res.body);
    // Only assert if fixtures exist; otherwise this is a no-op sanity check.
    if (found.some((n) => n.includes('ZZQA'))) {
      expect(found).toContain('ZZQA Alpha Default');
      expect(found).toContain('ZZQA Bravo SectorB');
    }
  });

  it('scoped recruiter sees own sector but NOT another (search path)', async () => {
    if (!up || !recruiterToken) return;
    const res = await authed(recruiterToken).get('/api/candidates?search=ZZQA&limit=20');
    expect(res.status).toBe(200);
    const found = names(res.body);
    expect(found).not.toContain('ZZQA Bravo SectorB');
    // If fixtures present, the own-sector candidate should appear.
    if (found.length) expect(found).toContain('ZZQA Alpha Default');
  });

  it('scoped recruiter does NOT leak another sector via the list path', async () => {
    if (!up || !recruiterToken) return;
    const res = await authed(recruiterToken).get('/api/candidates?limit=100');
    expect(res.status).toBe(200);
    expect(names(res.body)).not.toContain('ZZQA Bravo SectorB');
  });
});
