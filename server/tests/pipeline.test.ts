import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { authed, login, serverUp } from './helpers.js';

/**
 * M9 write flow: moving an application's pipeline stage must keep its
 * application `status` in lockstep (the stage↔status sync fix). Restores the
 * original stage afterwards so the run is side-effect-free.
 *
 * Uses the round-based model's first-class fixed stages (OFFER, HIRED) — the
 * legacy generic SCREENING/INTERVIEW stages are now per-job round names, so a
 * job without a round of that name normalizes them back to APPLIED.
 */
describe('M9 pipeline stage↔status sync', () => {
  let up = false;
  let token = '';
  let appId = '';
  let originalStage = '';

  beforeAll(async () => {
    up = await serverUp();
    if (!up) return;
    token = await login();
    const jobs = await authed(token).get('/api/jobs?limit=10');
    for (const job of jobs.body?.data?.items ?? []) {
      const board = await authed(token).get(
        `/api/pipeline/board?jobRequisitionId=${job.id}`,
      );
      for (const col of board.body?.data?.board?.columns ?? []) {
        const card = (col.applications ?? col.cards ?? [])[0];
        if (card?.applicationId ?? card?.id) {
          appId = card.applicationId ?? card.id;
          originalStage = card.stage ?? col.stage;
          break;
        }
      }
      if (appId) break;
    }
  });

  afterAll(async () => {
    if (up && appId && originalStage) {
      await authed(token)
        .patch(`/api/pipeline/applications/${appId}/stage`)
        .send({ toStage: originalStage });
    }
  });

  it('found an application to exercise', () => {
    if (!up) return;
    expect(appId, 'no pipeline application available').toBeTruthy();
  });

  it('moving to OFFER syncs status to OFFER', async () => {
    if (!up || !appId) return;
    const res = await authed(token)
      .patch(`/api/pipeline/applications/${appId}/stage`)
      .send({ toStage: 'OFFER' });
    expect(res.status).toBe(200);
    const data = res.body?.data?.card ?? res.body?.data;
    expect(data.stage).toBe('OFFER');
    expect(data.status).toBe('OFFER');
  });

  it('moving to HIRED syncs status to HIRED', async () => {
    if (!up || !appId) return;
    const res = await authed(token)
      .patch(`/api/pipeline/applications/${appId}/stage`)
      .send({ toStage: 'HIRED' });
    expect(res.status).toBe(200);
    const data = res.body?.data?.card ?? res.body?.data;
    expect(data.stage).toBe('HIRED');
    expect(data.status).toBe('HIRED');
  });

  it('moving to SCREENING/ASSESSMENT stage syncs status correctly', async () => {
    if (!up || !appId) return;
    // Look up the board first to find the stages list
    const jobs = await authed(token).get('/api/jobs?limit=10');
    let stages: string[] = [];
    for (const job of jobs.body?.data?.items ?? []) {
      const board = await authed(token).get(`/api/pipeline/board?jobRequisitionId=${job.id}`);
      const cols = board.body?.data?.board?.columns ?? board.body?.data?.columns ?? [];
      const hasApp = cols.some((col: any) => (col.applications ?? col.cards ?? []).some((card: any) => (card.applicationId ?? card.id) === appId));
      if (hasApp) {
        stages = board.body?.data?.board?.stages ?? board.body?.data?.stages ?? [];
        break;
      }
    }

    const stage = stages.find(s => s === 'SCREENING' || s === 'ASSESSMENT' || s.toLowerCase().includes('screening') || s.toLowerCase().includes('assessment'));
    if (!stage) return; // skip if neither screening nor assessment stages are configured for this job

    const res = await authed(token)
      .patch(`/api/pipeline/applications/${appId}/stage`)
      .send({ toStage: stage });
    expect(res.status).toBe(200);
    const data = res.body?.data?.card ?? res.body?.data;
    expect(data.stage).toBe(stage);
    // `stage` may be a custom workflow-round name (e.g. "Screening"), not just
    // the canonical constant — match it the same case-insensitive way it was
    // picked above, rather than with strict equality.
    expect(data.status).toBe(stage.toLowerCase().includes('screening') ? 'SCREENING' : 'ASSESSMENT');
  });

  it('moving to INTERVIEW/SCHEDULE stage syncs status correctly', async () => {
    if (!up || !appId) return;
    const jobs = await authed(token).get('/api/jobs?limit=10');
    let stages: string[] = [];
    for (const job of jobs.body?.data?.items ?? []) {
      const board = await authed(token).get(`/api/pipeline/board?jobRequisitionId=${job.id}`);
      const cols = board.body?.data?.board?.columns ?? board.body?.data?.columns ?? [];
      const hasApp = cols.some((col: any) => (col.applications ?? col.cards ?? []).some((card: any) => (card.applicationId ?? card.id) === appId));
      if (hasApp) {
        stages = board.body?.data?.board?.stages ?? board.body?.data?.stages ?? [];
        break;
      }
    }

    const stage = stages.find(s => s === 'INTERVIEW' || s === 'SCHEDULE' || s.toLowerCase().includes('interview') || s.toLowerCase().includes('schedule'));
    if (!stage) return; // skip if neither interview nor schedule stages are configured for this job

    const res = await authed(token)
      .patch(`/api/pipeline/applications/${appId}/stage`)
      .send({ toStage: stage });
    expect(res.status).toBe(200);
    const data = res.body?.data?.card ?? res.body?.data;
    expect(data.stage).toBe(stage);
    expect(data.status).toBe(stage.toUpperCase() === 'INTERVIEW' ? 'INTERVIEW' : 'SCHEDULE');
  });
});
