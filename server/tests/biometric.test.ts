import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { authed, login, ADMIN, serverUp, api } from './helpers.js';
import { prisma } from './helpers.js';

describe('Biometric Verification Flow', () => {
  let up = false;
  let token = '';
  let candidateId = '';
  let interviewId = '';
  let interviewToken = '';
  let candidateEmail = 'biometric.test@example.com';

  beforeAll(async () => {
    up = await serverUp();
    if (!up) return;
    token = await login(ADMIN);

    // Cleanup
    await prisma.$executeRawUnsafe(`DELETE FROM "BiometricReport" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${candidateEmail}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "InterviewQuestion" WHERE "interviewId" IN (SELECT id FROM "Interview" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${candidateEmail}'))`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CandidateAnswer" WHERE "interviewId" IN (SELECT id FROM "Interview" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${candidateEmail}'))`);
    await prisma.$executeRawUnsafe(`DELETE FROM "ProctorShot" WHERE "interviewId" IN (SELECT id FROM "Interview" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${candidateEmail}'))`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Interview" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email = '${candidateEmail}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Candidate" WHERE email = '${candidateEmail}'`);

    const sector = await prisma.sector.findFirst({ where: { name: 'Default' } });
    const domain = await prisma.domain.findFirst({ where: { sectorId: sector?.id } });
    const user = await prisma.user.findFirst({ where: { email: ADMIN.email } });
    const bank = await prisma.questionBank.findFirst();

    if (!sector || !domain || !user || !bank) throw new Error('Seeded database is missing required entities');

    // Set max warnings system config to 2 so the test terminates on warning 3
    await authed(token)
      .put('/api/system/config/interview.max_warnings')
      .send({ value: '2' });

    // Create Candidate
    const candidate = await prisma.candidate.create({
      data: {
        fullName: 'Biometric Test Candidate',
        email: candidateEmail,
        sectorId: sector.id,
        domainId: domain.id,
      },
    });
    candidateId = candidate.id;

    // Create Interview
    const interview = await prisma.interview.create({
      data: {
        candidateId,
        recruiterId: user.id,
        questionBankId: bank.id,
        status: 'SCHEDULED',
        accessToken: 'test-biometric-token-' + Date.now(),
        type: 'AI',
      },
    });
    interviewId = interview.id;
    interviewToken = interview.accessToken!;
  });

  afterAll(async () => {
    if (!up) return;
    await prisma.$executeRawUnsafe(`DELETE FROM "BiometricReport" WHERE "interviewId" = '${interviewId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "InterviewQuestion" WHERE "interviewId" = '${interviewId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CandidateAnswer" WHERE "interviewId" = '${interviewId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "ProctorShot" WHERE "interviewId" = '${interviewId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Interview" WHERE id = '${interviewId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Candidate" WHERE id = '${candidateId}'`);
  });

  it('1. Candidate enrolls biometric profile successfully', async () => {
    if (!up) return;

    const dummyImage = 'data:image/jpeg;base64,L2ltYWdl';
    const dummySignature = { topLeft: [10, 10], bottomRight: [100, 100], landmarks: [[15, 15], [30, 30], [50, 50], [70, 70], [80, 80], [90, 90]] };

    const res = await api()
      .post(`/api/interview/${interviewToken}/biometric/enroll`)
      .send({
        image: dummyImage,
        faceSignature: dummySignature,
      });

    expect(res.status).toBe(200);
    expect(res.body?.data?.enrolled).toBe(true);

    const report = await prisma.biometricReport.findUnique({
      where: { interviewId },
    });
    expect(report).toBeDefined();
    expect(report?.verificationStatus).toBe('VERIFIED');
  });

  it('2. Candidate verifies biometrics successfully with matching face', async () => {
    if (!up) return;

    const dummyImage = 'data:image/jpeg;base64,L2ltYWdl';
    const dummySignature = { topLeft: [10, 10], bottomRight: [100, 100], landmarks: [[15, 15], [30, 30], [50, 50], [70, 70], [80, 80], [90, 90]] };

    const res = await api()
      .post(`/api/interview/${interviewToken}/biometric/verify`)
      .send({
        image: dummyImage,
        faceSignature: dummySignature,
        matchScore: 95,
        isMatch: true,
        noFace: false,
        multipleFaces: false,
      });

    expect(res.status).toBe(200);
    expect(res.body?.data?.isMatch).toBe(true);
    expect(res.body?.data?.status).toBe('VERIFIED');
    expect(res.body?.data?.warnings).toBe(0);
  });

  it('3. Candidate mismatches face and triggers warning 1', async () => {
    if (!up) return;

    const dummyImage = 'data:image/jpeg;base64,L2ltYWdl';
    const dummySignature = { topLeft: [10, 10], bottomRight: [100, 100], landmarks: [[45, 45], [60, 60], [50, 50], [70, 70], [80, 80], [90, 90]] };

    const res = await api()
      .post(`/api/interview/${interviewToken}/biometric/verify`)
      .send({
        image: dummyImage,
        faceSignature: dummySignature,
        matchScore: 60,
        isMatch: false,
        noFace: false,
        multipleFaces: false,
      });

    expect(res.status).toBe(200);
    expect(res.body?.data?.isMatch).toBe(false);
    expect(res.body?.data?.status).toBe('FLAGGED');
    expect(res.body?.data?.warnings).toBe(1);
    expect(res.body?.data?.terminated).toBe(false);
  });

  it('4. Candidate mismatches face consecutively and triggers warnings 2 and 3 (termination)', async () => {
    if (!up) return;

    const dummyImage = 'data:image/jpeg;base64,L2ltYWdl';
    const dummySignature = { topLeft: [10, 10], bottomRight: [100, 100], landmarks: [[45, 45], [60, 60], [50, 50], [70, 70], [80, 80], [90, 90]] };

    // Mismatch 2
    let res = await api()
      .post(`/api/interview/${interviewToken}/biometric/verify`)
      .send({
        image: dummyImage,
        faceSignature: dummySignature,
        matchScore: 60,
        isMatch: false,
        noFace: false,
        multipleFaces: false,
      });

    expect(res.status).toBe(200);
    expect(res.body?.data?.warnings).toBe(2);
    expect(res.body?.data?.terminated).toBe(false);

    // Mismatch 3
    res = await api()
      .post(`/api/interview/${interviewToken}/biometric/verify`)
      .send({
        image: dummyImage,
        faceSignature: dummySignature,
        matchScore: 60,
        isMatch: false,
        noFace: false,
        multipleFaces: false,
      });

    expect(res.status).toBe(200);
    expect(res.body?.data?.status).toBe('FAILED');
    expect(res.body?.data?.warnings).toBe(3);
    expect(res.body?.data?.terminated).toBe(true);

    const report = await prisma.biometricReport.findUnique({
      where: { interviewId },
    });
    expect(report?.verificationStatus).toBe('FAILED');
  });
});
