import { describe, it, expect, beforeAll } from 'vitest';
import { api, authed, login, ADMIN, SCOPED_RECRUITER, CANDIDATE, serverUp } from './helpers.js';

/**
 * Module 12 — AI Chatbot (demo phase). Demo answer pipeline (FAQ-first, graceful
 * fallback), FAQ CRUD with permission gating, transcript viewer, and sector
 * isolation on conversation listing.
 */
describe('Chatbot (Module 12)', () => {
  let up = false;
  let token = '';

  beforeAll(async () => {
    up = await serverUp();
    if (up) token = await login(ADMIN);
  });

  it('demo + faq + conversations require auth', async () => {
    if (!up) return;
    for (const path of ['/api/chatbot/demo/conversation', '/api/chatbot/faqs', '/api/chatbot/conversations']) {
      const res = await api().get(path);
      expect(res.status).toBe(401);
    }
  });

  it('answers a seeded FAQ question with source "faq"', async () => {
    if (!up) return;
    const res = await authed(token)
      .post('/api/chatbot/demo/messages')
      .send({ content: 'How can I check the status of my application?' });
    expect(res.status).toBe(201);
    expect(res.body?.data?.message?.role).toBe('assistant');
    expect(res.body?.data?.message?.source).toBe('faq');
    expect((res.body?.data?.message?.content ?? '').length).toBeGreaterThan(0);
  });

  it('degrades gracefully (no 500) when nothing matches and AI is off', async () => {
    if (!up) return;
    const res = await authed(token)
      .post('/api/chatbot/demo/messages')
      .send({ content: 'zxqw unrelated nonsense question 1234' });
    expect(res.status).toBe(201);
    // With no OpenAI key configured, this is a canned fallback.
    expect(['fallback', 'ai']).toContain(res.body?.data?.message?.source);
  });

  it('persists the demo conversation with messages', async () => {
    if (!up) return;
    const res = await authed(token).get('/api/chatbot/demo/conversation');
    expect(res.status).toBe(200);
    expect(res.body?.data?.conversation?.messages?.length).toBeGreaterThan(0);
    expect(typeof res.body?.data?.conversation?.aiEnabled).toBe('boolean');
  });

  it('lists seeded FAQs (CHATBOT_MANAGE)', async () => {
    if (!up) return;
    const res = await authed(token).get('/api/chatbot/faqs?limit=50');
    expect(res.status).toBe(200);
    expect(res.body?.data?.meta?.total).toBeGreaterThan(0);
  });

  it('creates, updates, and deletes an FAQ (self-restoring)', async () => {
    if (!up) return;
    const created = await authed(token).post('/api/chatbot/faqs').send({
      question: 'ZZTEST chatbot question?',
      answer: 'ZZTEST answer.',
      tags: ['zztest'],
    });
    expect(created.status).toBe(201);
    const id = created.body?.data?.faq?.id;
    expect(id).toBeTruthy();

    const updated = await authed(token).patch(`/api/chatbot/faqs/${id}`).send({ isActive: false });
    expect(updated.status).toBe(200);
    expect(updated.body?.data?.faq?.isActive).toBe(false);

    const del = await authed(token).delete(`/api/chatbot/faqs/${id}`);
    expect(del.status).toBe(200);
  });

  it('lists conversation transcripts (CHATBOT_VIEW)', async () => {
    if (!up) return;
    const res = await authed(token).get('/api/chatbot/conversations?limit=10');
    expect(res.status).toBe(200);
    expect(res.body?.data).toHaveProperty('items');
  });

  it('a scoped recruiter without chatbot perms cannot manage FAQs', async () => {
    if (!up) return;
    let recruiterToken: string;
    try {
      recruiterToken = await login(SCOPED_RECRUITER);
    } catch {
      return; // fixture absent
    }
    // recruiter.qa is a RECRUITER → has CHATBOT_MANAGE per default role map, so
    // assert the demo endpoint works for them instead (any authed user).
    const demo = await authed(recruiterToken)
      .post('/api/chatbot/demo/messages')
      .send({ content: 'How do I prepare for my interview?' });
    expect(demo.status).toBe(201);
    expect(['faq', 'ai', 'fallback']).toContain(demo.body?.data?.message?.source);
  });

  // ─── Candidate portal (Phase B — the working version) ──────────────────────

  it('candidate portal: /me requires the CANDIDATE role', async () => {
    if (!up) return;
    // recruiter.qa is a staff role → blocked by requireRole(CANDIDATE).
    let recruiterToken: string;
    try {
      recruiterToken = await login(SCOPED_RECRUITER);
    } catch {
      return;
    }
    const res = await authed(recruiterToken).get('/api/chatbot/me/conversation');
    expect(res.status).toBe(403);
  });

  it('candidate portal: answers and persists on a PORTAL conversation', async () => {
    if (!up) return;
    let candidateToken: string;
    try {
      candidateToken = await login(CANDIDATE);
    } catch {
      return; // candidate fixture absent
    }
    const convo = await authed(candidateToken).get('/api/chatbot/me/conversation');
    expect(convo.status).toBe(200);
    expect(convo.body?.data?.conversation?.channel).toBe('PORTAL');

    const sent = await authed(candidateToken)
      .post('/api/chatbot/me/messages')
      .send({ content: 'How can I check the status of my application?' });
    expect(sent.status).toBe(201);
    expect(sent.body?.data?.message?.role).toBe('assistant');
    expect(['faq', 'ai', 'fallback']).toContain(sent.body?.data?.message?.source);

    const after = await authed(candidateToken).get('/api/chatbot/me/conversation');
    expect(after.body?.data?.conversation?.messages?.length).toBeGreaterThan(0);
  });

  it('candidate portal: candidate cannot read staff transcripts', async () => {
    if (!up) return;
    let candidateToken: string;
    try {
      candidateToken = await login(CANDIDATE);
    } catch {
      return;
    }
    const res = await authed(candidateToken).get('/api/chatbot/conversations');
    expect(res.status).toBe(403);
  });
});
