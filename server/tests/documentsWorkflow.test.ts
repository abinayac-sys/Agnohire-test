import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { authed, login, ADMIN, serverUp } from './helpers.js';
import { prisma } from './helpers.js';

describe('Candidate Document Collection & Verification Workflow', () => {
  let up = false;
  let token = '';
  let candidateId = '';
  let applicationId = '';
  let jobId = '';
  let offerId = '';
  let docRequirementId = '';
  let candidateEmail = 'zzqa.docflow@example.com';

  beforeAll(async () => {
    up = await serverUp();
    if (!up) return;
    token = await login(ADMIN);

    // Cleanup
    await prisma.$executeRawUnsafe(`DELETE FROM "Onboarding" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${candidateEmail}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "OfferDocument" WHERE "offerId" IN (SELECT id FROM "Offer" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${candidateEmail}'))`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Offer" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${candidateEmail}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "JobApplication" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${candidateEmail}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Candidate" WHERE email = '${candidateEmail}'`);

    const sector = await prisma.sector.findFirst({ where: { name: 'Default' } });
    const domain = await prisma.domain.findFirst({ where: { sectorId: sector?.id } });
    const user = await prisma.user.findFirst({ where: { email: ADMIN.email } });

    if (!sector || !domain || !user) throw new Error('Seeded database is missing required entities');

    // Fixtures must carry the admin's tenantId explicitly: the API reads are
    // tenant-scoped, so a row left with a NULL tenantId is invisible to it.
    const tenantId = user.tenantId;
    if (!tenantId) throw new Error('Admin fixture has no tenantId — reseed the database');

    // Create Candidate
    const candidate = await prisma.candidate.create({
      data: {
        fullName: 'ZZQA Doc Flow Candidate',
        email: candidateEmail,
        sectorId: sector.id,
        domainId: domain.id,
        tenantId,
      },
    });
    candidateId = candidate.id;

    // Find a job requisition in the same tenant as the caller.
    const job = await prisma.jobRequisition.findFirst({
      where: { status: 'OPEN', tenantId },
    });
    if (!job) throw new Error('No OPEN job requisition found');
    jobId = job.id;

    // Create JobApplication
    const app = await prisma.jobApplication.create({
      data: {
        candidateId,
        jobRequisitionId: jobId,
        status: 'APPLIED',
        stage: 'APPLIED',
        tenantId,
      },
    });
    applicationId = app.id;
  });

  afterAll(async () => {
    if (!up) return;
    // Cleanup
    await prisma.$executeRawUnsafe(`DELETE FROM "Onboarding" WHERE "candidateId" = '${candidateId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "OfferDocument" WHERE "offerId" = '${offerId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Offer" WHERE "candidateId" = '${candidateId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "JobApplication" WHERE "candidateId" = '${candidateId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Candidate" WHERE id = '${candidateId}'`);
  });

  it('1. HR creates an offer in DRAFT status', async () => {
    if (!up) return;

    const res = await authed(token)
      .post('/api/offers')
      .send({
        applicationId,
        salaryOffered: 90000,
        joiningDate: new Date(Date.now() + 86400000 * 30).toISOString(),
        validUntil: new Date(Date.now() + 86400000 * 7).toISOString(),
        notes: 'ZZQA Test offer notes',
      });

    expect(res.status).toBe(201);
    expect(res.body?.data?.offer?.status).toBe('DRAFT');
    offerId = res.body.data.offer.id;
    expect(offerId).toBeDefined();
  });

  it('2. HR adds a mandatory document requirement to the offer', async () => {
    if (!up) return;

    const res = await authed(token)
      .post(`/api/offers/${offerId}/documents/requirements`)
      .send({
        name: 'PAN Card',
        description: 'Please upload a clear copy of your PAN Card.',
        required: true,
        type: 'PDF/JPG/PNG',
        maxSizeInt: 5,
      });

    expect(res.status).toBe(201);
    const offer = res.body?.data?.offer;
    expect(offer).toBeDefined();
    const docReq = offer.documents.find((d: any) => d.name === 'PAN Card');
    expect(docReq).toBeDefined();
    expect(docReq.required).toBe(true);
    expect(docReq.status).toBe('PENDING');
    docRequirementId = docReq.id;
  });

  it('3. HR sends the offer and marks it ACCEPTED (starts onboarding, triggers email)', async () => {
    if (!up) return;

    // Send the offer to set acceptanceToken and status SENT
    const sendRes = await authed(token).post(`/api/offers/${offerId}/send`);
    expect(sendRes.status).toBe(200);
    const offerSent = sendRes.body?.data?.offer;
    expect(offerSent.status).toBe('SENT');
    const tokenStr = offerSent.acceptanceToken;
    expect(tokenStr).toBeDefined();

    // Respond/accept the offer
    const acceptRes = await authed(token)
      .post(`/api/offers/${offerId}/respond`)
      .send({
        status: 'ACCEPTED',
        signature: 'ZZQA Candidate Signature',
      });

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body?.data?.offer?.status).toBe('ACCEPTED');
  });

  it('3b. HR manually sends document request email', async () => {
    if (!up) return;

    const res = await authed(token).post(`/api/offers/${offerId}/documents/send-email`);
    expect(res.status).toBe(200);
    expect(res.body?.data?.message).toContain('successfully');
  });

  it('4. Candidate accesses their document portal publicly', async () => {
    if (!up) return;

    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    const tokenStr = offer?.acceptanceToken;
    expect(tokenStr).toBeTruthy();

    const res = await api().get(`/api/offer/documents/${tokenStr}`);
    expect(res.status).toBe(200);
    expect(res.body?.data?.candidateName).toContain('ZZQA');
    expect(res.body?.data?.documents.length).toBeGreaterThan(0);
    const doc = res.body.data.documents.find((d: any) => d.id === docRequirementId);
    expect(doc).toBeDefined();
    expect(doc.status).toBe('PENDING');
  });

  it('5. Candidate uploads the requested document', async () => {
    if (!up) return;

    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    const tokenStr = offer?.acceptanceToken;

    const res = await api()
      .post(`/api/offer/documents/${tokenStr}/upload/${docRequirementId}`)
      .send({
        fileUrl: '/api/files/zzqa-pan-card.pdf/download',
      });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);

    const doc = await prisma.offerDocument.findUnique({ where: { id: docRequirementId } });
    expect(doc?.status).toBe('UPLOADED');
    expect(doc?.fileUrl).toBe('/api/files/zzqa-pan-card.pdf/download');
  });

  it('6. HR rejects the document with a reason', async () => {
    if (!up) return;

    const res = await authed(token)
      .post(`/api/offers/${offerId}/documents/${docRequirementId}/reject`)
      .send({
        reason: 'Blurry Document copy, please re-upload.',
      });

    expect(res.status).toBe(200);
    const doc = res.body?.data?.offer?.documents.find((d: any) => d.id === docRequirementId);
    expect(doc.status).toBe('REJECTED');
    expect(doc.rejectionReason).toBe('Blurry Document copy, please re-upload.');
  });

  it('7. Candidate re-uploads correct document', async () => {
    if (!up) return;

    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    const tokenStr = offer?.acceptanceToken;

    const res = await api()
      .post(`/api/offer/documents/${tokenStr}/upload/${docRequirementId}`)
      .send({
        fileUrl: '/api/files/zzqa-pan-card-new.pdf/download',
      });

    expect(res.status).toBe(200);

    const doc = await prisma.offerDocument.findUnique({ where: { id: docRequirementId } });
    expect(doc?.status).toBe('UPLOADED');
    expect(doc?.rejectionReason).toBeNull();
  });

  it('8. Onboarding cannot be completed if document is not verified', async () => {
    if (!up) return;

    const res = await authed(token)
      .patch(`/api/offers/${offerId}/onboarding`)
      .send({
        status: 'COMPLETED',
      });

    expect(res.status).toBe(400);
    expect(res.body?.error?.message).toContain('must be verified');
  });

  it('9. HR verifies the document and completes onboarding', async () => {
    if (!up) return;

    const verifyRes = await authed(token)
      .post(`/api/offers/${offerId}/documents/${docRequirementId}/verify`);

    expect(verifyRes.status).toBe(200);
    const doc = verifyRes.body?.data?.offer?.documents.find((d: any) => d.id === docRequirementId);
    expect(doc.status).toBe('VERIFIED');

    const completeRes = await authed(token)
      .patch(`/api/offers/${offerId}/onboarding`)
      .send({
        status: 'COMPLETED',
      });

    expect(completeRes.status).toBe(200);
  });
});

import { api } from './helpers.js';
