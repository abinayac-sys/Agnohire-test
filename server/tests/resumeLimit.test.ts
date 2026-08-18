import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { authed, login, ADMIN, serverUp } from './helpers.js';
import { prisma } from './helpers.js';

describe('Candidate single resume limit', () => {
  let up = false;
  let token = '';
  let candidateId = '';
  const testEmail = 'zzqa.resumetest@example.com';

  beforeAll(async () => {
    up = await serverUp();
    if (!up) return;
    token = await login(ADMIN);

    // Hard delete any existing test candidate to prevent duplicate issues
    await prisma.$executeRawUnsafe(`DELETE FROM "JobApplication" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${testEmail}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Resume" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${testEmail}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Candidate" WHERE email = '${testEmail}'`);

    // Create a new candidate for testing
    const sector = await prisma.sector.findFirst({ where: { name: 'Default' } });
    const sectorId = sector?.id ?? null;

    const res = await authed(token)
      .post('/api/candidates')
      .send({
        fullName: 'ZZQA Resume Test Candidate',
        email: testEmail,
        skills: ['Test'],
        sectorId,
        consentGiven: true,
      });
    
    expect(res.status).toBe(201);
    candidateId = res.body?.data?.candidate?.id;
    expect(candidateId).toBeDefined();
  });

  afterAll(async () => {
    if (!up) return;
    // Hard delete test data
    await prisma.$executeRawUnsafe(`DELETE FROM "JobApplication" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${testEmail}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Resume" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${testEmail}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Candidate" WHERE email = '${testEmail}'`);
  });

  it('rejects duplicate resume uploads and imports', async () => {
    if (!up) return;

    const pdfBuffer = Buffer.from('%PDF-1.4 mock resume content');

    // 1. First upload should succeed
    const uploadRes1 = await authed(token)
      .post(`/api/candidates/${candidateId}/resumes`)
      .attach('file', pdfBuffer, 'resume1.pdf');
    
    expect(uploadRes1.status).toBe(201);
    const resumeId = uploadRes1.body?.data?.resume?.id;
    expect(resumeId).toBeDefined();

    // 2. Second upload should fail with 400
    const uploadRes2 = await authed(token)
      .post(`/api/candidates/${candidateId}/resumes`)
      .attach('file', pdfBuffer, 'resume2.pdf');
    
    expect(uploadRes2.status).toBe(400);
    expect(uploadRes2.body?.error?.message).toContain('already has an uploaded resume');

    // 3. Import from URL should also fail with 400
    const importRes = await authed(token)
      .post(`/api/candidates/${candidateId}/resumes/from-url`)
      .send({ url: 'https://example.com/test.pdf' });
    
    expect(importRes.status).toBe(400);
    expect(importRes.body?.error?.message).toContain('already has an uploaded resume');

    // 4. Delete the first resume
    const deleteRes = await authed(token)
      .delete(`/api/candidates/${candidateId}/resumes/${resumeId}`);
    
    expect(deleteRes.status).toBe(200);

    // 5. Subsequent upload should succeed again
    const uploadRes3 = await authed(token)
      .post(`/api/candidates/${candidateId}/resumes`)
      .attach('file', pdfBuffer, 'resume3.pdf');
    
    expect(uploadRes3.status).toBe(201);
  });
});
