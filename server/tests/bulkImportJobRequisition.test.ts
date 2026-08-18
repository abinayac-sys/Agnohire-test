import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { authed, login, ADMIN, serverUp } from './helpers.js';
import { prisma } from './helpers.js';

describe('Candidate bulk upload with jobRequisition', () => {
  let up = false;
  let token = '';
  let sectorId: string;
  let domainId: string;
  let adminId: string;
  let openJobId: string;
  let closedJobId: string;
  const createdCandidateEmails: string[] = [];
  const createdListIds: string[] = [];

  beforeAll(async () => {
    up = await serverUp();
    if (!up) return;
    token = await login(ADMIN);

    // Clean up pre-existing candidates and lists from prior crashed runs case-insensitively using raw SQL to bypass soft-delete middleware
    await prisma.$executeRawUnsafe(`DELETE FROM "JobApplication" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email ILIKE '%zzqa%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CandidateListItem" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email ILIKE '%zzqa%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CandidateAssignment" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email ILIKE '%zzqa%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Resume" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email ILIKE '%zzqa%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Candidate" WHERE email ILIKE '%zzqa%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CandidateListItem" WHERE "candidateListId" IN (SELECT id FROM "CandidateList" WHERE name ILIKE '%zzqa%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CandidateAssignment" WHERE "listId" IN (SELECT id FROM "CandidateList" WHERE name ILIKE '%zzqa%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CandidateList" WHERE name ILIKE '%zzqa%'`);

    // Get reference IDs from the database to create test data
    const sector = await prisma.sector.findFirst({ where: { name: 'Default' } });
    if (!sector) throw new Error('Default sector not found');
    sectorId = sector.id;

    const domain = await prisma.domain.findFirst({ where: { sectorId } });
    if (!domain) throw new Error('No domain found in Default sector');
    domainId = domain.id;

    const admin = await prisma.user.findFirst({ where: { email: ADMIN.email } });
    if (!admin) throw new Error('Admin user not found');
    adminId = admin.id;

    const tenantId = sector.tenantId;
    const organizationId = sector.organizationId;
    const workspaceId = sector.workspaceId;

    // Create a test OPEN job requisition
    const openJob = await prisma.jobRequisition.create({
      data: {
        title: 'ZZQA Bulk Open Job',
        description: 'Test job requisition description',
        sectorId,
        domainId,
        createdById: adminId,
        tenantId,
        organizationId,
        workspaceId,
        status: 'OPEN',
      },
    });
    openJobId = openJob.id;

    // Create a test CLOSED job requisition
    const closedJob = await prisma.jobRequisition.create({
      data: {
        title: 'ZZQA Bulk Closed Job',
        description: 'Test job requisition description',
        sectorId,
        domainId,
        createdById: adminId,
        tenantId,
        organizationId,
        workspaceId,
        status: 'CLOSED',
      },
    });
    closedJobId = closedJob.id;
  });

  afterAll(async () => {
    if (!up) return;

    // Delete a set of JobApplications and everything that FK-references them
    // first (Offer → OfferDocument/Onboarding, and PipelineNote — none cascade),
    // so the hard delete doesn't trip a foreign-key constraint.
    const deleteApplications = async (appWhere: string) => {
      const apps = `SELECT id FROM "JobApplication" WHERE ${appWhere}`;
      const offers = `SELECT id FROM "Offer" WHERE "applicationId" IN (${apps})`;
      await prisma.$executeRawUnsafe(`DELETE FROM "Onboarding" WHERE "offerId" IN (${offers})`);
      await prisma.$executeRawUnsafe(`DELETE FROM "OfferDocument" WHERE "offerId" IN (${offers})`);
      await prisma.$executeRawUnsafe(`DELETE FROM "Offer" WHERE "applicationId" IN (${apps})`);
      await prisma.$executeRawUnsafe(`DELETE FROM "PipelineNote" WHERE "applicationId" IN (${apps})`);
      await prisma.$executeRawUnsafe(`DELETE FROM "JobApplication" WHERE ${appWhere}`);
    };

    // Clean up using raw SQL hard deletes
    await deleteApplications(`"candidateId" IN (SELECT id FROM "Candidate" WHERE email ILIKE '%zzqa%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CandidateListItem" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email ILIKE '%zzqa%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CandidateAssignment" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email ILIKE '%zzqa%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Resume" WHERE "candidateId" IN (SELECT id FROM "Candidate" WHERE email ILIKE '%zzqa%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Candidate" WHERE email ILIKE '%zzqa%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CandidateListItem" WHERE "candidateListId" IN (SELECT id FROM "CandidateList" WHERE name ILIKE '%zzqa%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CandidateAssignment" WHERE "listId" IN (SELECT id FROM "CandidateList" WHERE name ILIKE '%zzqa%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "CandidateList" WHERE name ILIKE '%zzqa%'`);

    if (openJobId) {
      await deleteApplications(`"jobRequisitionId" = '${openJobId}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM "JobRequisition" WHERE id = '${openJobId}'`);
    }
    if (closedJobId) {
      await deleteApplications(`"jobRequisitionId" = '${closedJobId}'`);
      await prisma.$executeRawUnsafe(`DELETE FROM "JobRequisition" WHERE id = '${closedJobId}'`);
    }
  });

  it('processes candidates with open, closed, non-existent, and empty job requisitions', async () => {
    if (!up) return;

    const emails = [
      'zzqa.bulk1@example.com',
      'zzqa.bulk2@example.com',
      'zzqa.bulk3@example.com',
      'zzqa.bulk4@example.com',
    ];
    createdCandidateEmails.push(...emails);

    // CSV format: fullName,email,phone,currentRole,location,experienceLevel,skills,source,linkedinUrl,githubUrl,resumeUrl,jobRequisition
    const csvContent = [
      'fullName,email,jobRequisition',
      `Bulk Candidate 1,${emails[0]},ZZQA Bulk Open Job`, // Matching OPEN job by title (case-insensitive title)
      `Bulk Candidate 2,${emails[1]},${closedJobId}`, // Matching CLOSED job by UUID
      `Bulk Candidate 3,${emails[2]},ZZQA Nonexistent Job`, // Non-existent job title
      `Bulk Candidate 4,${emails[3]},`, // Empty job requisition
    ].join('\n');

    // Upload list
    const res = await authed(token)
      .post('/api/candidates/lists')
      .attach('file', Buffer.from(csvContent), 'candidates.csv')
      .field('name', 'ZZQA Bulk Import JobRequisition Test');

    expect(res.status).toBe(201);
    const listId = res.body?.data?.list?.id;
    expect(listId).toBeDefined();
    createdListIds.push(listId);

    // Poll until candidate list processing completes (since it might run async)
    let listStatus = 'PROCESSING';
    let errorReport: any[] = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, 200));
      const checkRes = await authed(token).get(`/api/candidates/lists/${listId}`);
      listStatus = checkRes.body?.data?.list?.status;
      errorReport = checkRes.body?.data?.list?.errorReport || [];
      if (listStatus === 'COMPLETED' || listStatus === 'FAILED') {
        break;
      }
    }

    expect(listStatus).toBe('COMPLETED');

    // Verify candidates exist in the database
    const dbCandidates = await prisma.candidate.findMany({
      where: { email: { in: emails } },
      include: { applications: true },
    });
    expect(dbCandidates.length).toBe(4);

    const c1 = dbCandidates.find((c) => c.email === emails[0]);
    const c2 = dbCandidates.find((c) => c.email === emails[1]);
    const c3 = dbCandidates.find((c) => c.email === emails[2]);
    const c4 = dbCandidates.find((c) => c.email === emails[3]);

    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c3).toBeDefined();
    expect(c4).toBeDefined();

    // Verify applications and reports
    // Candidate 1 (OPEN job): application created
    expect(c1!.applications.length).toBe(1);
    expect(c1!.applications[0].jobRequisitionId).toBe(openJobId);
    expect(c1!.applications[0].status).toBe('APPLIED');

    // Candidate 2 (CLOSED job): no application, has error in report
    expect(c2!.applications.length).toBe(0);
    const c2Error = errorReport.find((e) => e.email === emails[1]);
    expect(c2Error).toBeDefined();
    expect(c2Error.reason).toContain('is not OPEN');

    // Candidate 3 (Non-existent job): no application, has error in report
    expect(c3!.applications.length).toBe(0);
    const c3Error = errorReport.find((e) => e.email === emails[2]);
    expect(c3Error).toBeDefined();
    expect(c3Error.reason).toContain('not found');

    // Candidate 4 (Empty jobRequisition): no application, no error in report
    expect(c4!.applications.length).toBe(0);
    const c4Error = errorReport.find((e) => e.email === emails[3]);
    expect(c4Error).toBeUndefined();
  });

  it('can delete a candidate list', async () => {
    if (!up || createdListIds.length === 0) return;
    const listId = createdListIds[0];

    // Verify list is initially visible
    const getBefore = await authed(token).get(`/api/candidates/lists/${listId}`);
    expect(getBefore.status).toBe(200);

    // Delete list
    const delRes = await authed(token).delete(`/api/candidates/lists/${listId}`);
    expect(delRes.status).toBe(200);

    // Verify GET list returns 404
    const getAfter = await authed(token).get(`/api/candidates/lists/${listId}`);
    expect(getAfter.status).toBe(404);

    // Verify list is not in candidate list index
    const indexRes = await authed(token).get('/api/candidates/lists?limit=100');
    expect(indexRes.status).toBe(200);
    const listIds = (indexRes.body?.data?.items ?? []).map((l: any) => l.id);
    expect(listIds).not.toContain(listId);

    // Remove from createdListIds so it doesn't double-clean/fail in afterAll
    createdListIds.shift();
  });
});
